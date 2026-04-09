import { _decorator, Component, Node, input, Input, EventTouch, Camera, Vec3, Vec2, Quat, director } from 'cc';
import { CirclePath } from './CirclePath';
import { Hole } from './Hole';
import { GameManager } from './GameManager';
import { TutorialHand } from './TutorialHandManager';
const { ccclass, property } = _decorator;

enum SnakeState { IDLE, GOING, RETURNING, ENTERING_HOLE }

@ccclass('WormController')
export class WormController extends Component {

    @property(Camera) mainCamera: Camera = null!;
    @property moveSpeed: number = 8;
    @property segmentSpacing: number = 0.28;
    @property sensingDistance: number = 0.6;
    @property(Hole) targetHole: Hole = null!; 
    @property(CirclePath) exitPath: CirclePath = null!; 
    @property snakeColor: string = "Grey";

    private headNode: Node = null!;
    private segments: Node[] = []; 
    private allParts: Node[] = [];
    private state: SnakeState = SnakeState.IDLE;
    private moveDirection: Vec3 = new Vec3();
    private track: Vec3[] = []; 
    private startPathSize: number = 0;
    private startPositions: Vec3[] = [];
    private startRotations: Quat[] = [];

    // --- LOGIC TRACKING ---
    private holeEntryTime: number = 0;
    private jamTimer: number = 0;
    private isOnCircularPath: boolean = false;

    onLoad() {
        const children = this.node.children;
        if (children.length < 2) return;
        this.headNode = children[0];
        
        let unsorted = children.slice(1);
        this.segments = []; 
        let currentPiece = this.headNode;
        while (unsorted.length > 0) {
            let idx = 0; let min = 1000;
            for (let j = 0; j < unsorted.length; j++) {
                let d = Vec3.distance(currentPiece.worldPosition, unsorted[j].worldPosition);
                if (d < min) { min = d; idx = j; }
            }
            this.segments.push(unsorted[idx]);
            currentPiece = unsorted[idx];
            unsorted.splice(idx, 1);
        }

        this.allParts = [this.headNode, ...this.segments];
        this.startPositions = this.allParts.map(p => p.worldPosition.clone());
        this.startRotations = this.allParts.map(p => p.worldRotation.clone());
        this.buildInitialPath();
    }

    private buildInitialPath() {
        this.track = [];
        for (let i = 0; i < this.allParts.length - 1; i++) {
            const a = this.allParts[i].worldPosition, b = this.allParts[i + 1].worldPosition;
            for (let t = 0; t < 60; t++) this.track.push(Vec3.lerp(new Vec3(), a, b, t / 60));
        }
        this.track.push(this.allParts[this.allParts.length-1].worldPosition.clone());
        this.startPathSize = this.track.length;
    }

    private forceResetToStart() {
        for (let p of this.allParts) { p.active = true; }
        for (let i = 0; i < this.allParts.length; i++) {
            this.allParts[i].setWorldPosition(this.startPositions[i]);
            this.allParts[i].setWorldRotation(this.startRotations[i]);
        }
        this.buildInitialPath();
        this.state = SnakeState.IDLE;
        this.isOnCircularPath = false;
        this.jamTimer = 0;
    }

    start() { input.on(Input.EventType.TOUCH_START, this.onTouchStart, this); }

    onTouchStart(event: EventTouch) {
        if (GameManager.instance) {
            GameManager.instance.onUserInteraction();
            GameManager.instance.beginTimer();
        }
        if (this.state !== SnakeState.IDLE) return;

        if (TutorialHand.instance) {
            TutorialHand.instance.resetIdleTimer();
        }

        let clickedMe = false;
        const touchPos = event.getLocation(); 
        for (const part of this.allParts) {
            const sPos = new Vec3();
            this.mainCamera.worldToScreen(part.worldPosition, sPos);
            if (Vec2.distance(touchPos, new Vec2(sPos.x, sPos.y)) < 30) {
                clickedMe = true;
                break;
            }
        }

        if (clickedMe) {
            if (this.canSlitherOut()) {
                GameManager.instance.playSFX('tap');
                this.beginSlither();
            } else {
                GameManager.instance.playSFX('wrong');
            }
        }
    }

    public isIdle(): boolean { return this.state === SnakeState.IDLE; }

    private beginSlither() {
        Vec3.transformQuat(this.moveDirection, new Vec3(-1, 0, 0), this.headNode.worldRotation);
        this.moveDirection.normalize();
        this.state = SnakeState.GOING;
    }

    update(dt: number) {
        if (this.state === SnakeState.IDLE) return;

        if (this.state === SnakeState.GOING) {
            this.processGoingLogic(dt);
        } 
        else if (this.state === SnakeState.ENTERING_HOLE) {
            this.processForceEntry(dt);
        }
        else if (this.state === SnakeState.RETURNING) {
            for(let i=0; i<4; i++){
                if (this.track.length > this.startPathSize) {
                    this.track.shift(); this.headNode.worldPosition = this.track[0].clone();
                } else { this.forceResetToStart(); return; }
            }
        }
        this.applyPathToBody();
    }

    private processGoingLogic(dt: number) {
        // --- TRAFFIC yielding SENSING ---
        const obstacleType = this.checkForwardPath();

        if (obstacleType === "STATIC") {
            GameManager.instance.playSFX('wrong');
            this.state = SnakeState.RETURNING; // Return if blocked by idle snake in heart
            return;
        } else if (obstacleType === "TRAFFIC") {
            // WAIT AND TRIGGER END SCREEN IF NO SPACE
            this.jamTimer += dt;
            if (this.isOnCircularPath && this.jamTimer > 4.5) {
                if (GameManager.instance) GameManager.instance.gameOver();
            }
            return; // Freezes movement until clear
        }

        // Path is Clear - Proceed
        this.jamTimer = 0;
        let nextPos = this.headNode.worldPosition.clone().add(this.moveDirection.clone().multiplyScalar(this.moveSpeed * dt));

        if (this.exitPath) {
            const center = this.exitPath.getCenter();
            const dCenter = Vec3.distance(nextPos, center);
            if (dCenter >= this.exitPath.radius - 0.15) {
                this.isOnCircularPath = true;
                let rad = new Vec3(); Vec3.subtract(rad, nextPos, center);
                rad.normalize().multiplyScalar(this.exitPath.radius);
                Vec3.add(nextPos, center, rad); 
                this.moveDirection = this.exitPath.getTangentAt(nextPos);

                if (this.targetHole && this.targetHole.canAccept(this.snakeColor)) {
                    let hDir = new Vec3(); Vec3.subtract(hDir, this.targetHole.node.worldPosition, center);
                    let sDir = new Vec3(); Vec3.subtract(sDir, nextPos, center);
                    if (Vec3.dot(hDir.normalize(), sDir.normalize()) > 0.985) {
                        this.state = SnakeState.ENTERING_HOLE; this.holeEntryTime = 0; 
                        if (this.targetHole) this.targetHole.playHoleAnimation(); 
                        return;
                    }
                }
            }
        }

        this.headNode.worldPosition = nextPos;
        this.track.unshift(nextPos.clone());
        if (this.headNode.worldPosition.length() > 65) this.node.active = false;
    }

    private checkForwardPath(): "NONE" | "STATIC" | "TRAFFIC" {
        const others = director.getScene()!.getComponentsInChildren(WormController);
        const sensor = this.headNode.worldPosition.clone().add(this.moveDirection.clone().multiplyScalar(0.45));

        for (let other of others) {
            if (other === this || !other.node.active) continue;
            for (let part of other.allParts) {
                if (Vec3.distance(sensor, part.worldPosition) < 0.35) {
                    let dot = Vec3.dot(this.moveDirection, Vec3.subtract(new Vec3(), part.worldPosition, this.headNode.worldPosition).normalize());
                    if (dot > 0.7) {
                        return other.state === SnakeState.IDLE ? "STATIC" : "TRAFFIC";
                    }
                }
            }
        }
        return "NONE";
    }

    private processForceEntry(dt: number) {
        this.holeEntryTime += dt;
        const holePos = this.targetHole.node.worldPosition;
        let dir = new Vec3(); Vec3.subtract(dir, holePos, this.headNode.worldPosition);
        const vSpeed = this.moveSpeed * 1.5;

        const step = dir.length() < 0.1 ? this.moveDirection.clone().multiplyScalar(vSpeed * dt) : dir.normalize().multiplyScalar(vSpeed * dt);
        const nPos = this.headNode.worldPosition.clone().add(step);
        this.headNode.worldPosition = nPos;
        this.track.unshift(nPos.clone());

        const hr = 0.35;
        if (this.headNode.active && Vec3.distance(this.headNode.worldPosition, holePos) < hr) this.headNode.active = false;
        let done = !this.headNode.active;
        for (let s of this.segments) {
            if (s.active) {
                if (Vec3.distance(s.worldPosition, holePos) < hr) s.active = false;
                else done = false;
            }
        }
        if (done || this.holeEntryTime > 2.5) {
            this.node.active = false;

            if (this.targetHole) {
        // --- STOP ANIMATION ---
        this.targetHole.stopHoleAnimation();
        this.targetHole.onSnakeSorted();
    }
        }
    }

    public canSlitherOut(): boolean {
        // Step 1: Pre-calculate the ACTUAL move direction
        let predictDir = new Vec3();
        Vec3.transformQuat(predictDir, new Vec3(-1, 0, 0), this.headNode.worldRotation);
        predictDir.normalize();

        // Step 2: Set the sensor point further out to ensure it detects the blockage
        const sensor = this.headNode.worldPosition.clone().add(predictDir.clone().multiplyScalar(0.55));
        
        const others = director.getScene()!.getComponentsInChildren(WormController);
        for (let other of others) {
            if (other === this || !other.node.active) continue;
            for (let part of other.allParts) {
                // If a piece of another snake is in the "Block Zone"
                if (Vec3.distance(sensor, part.worldPosition) < 0.45) {
                    let toPart = Vec3.subtract(new Vec3(), part.worldPosition, this.headNode.worldPosition).normalize();
                    // Is the obstacle in our direct line of sight?
                    if (Vec3.dot(predictDir, toPart) > 0.65) return false; 
                }
            }
        }
        return true; // Path is definitely clear
    }

    private applyPathToBody() {
        let pIdx = 0; let lastPos = this.headNode.worldPosition;
        for (let i = 0; i < this.segments.length; i++) {
            const s = this.segments[i];
            let dNeed = this.segmentSpacing; let dCovered = 0;
            while (pIdx < this.track.length - 1) {
                const d = Vec3.distance(this.track[pIdx], this.track[pIdx + 1]);
                if (dCovered + d >= dNeed) {
                    const pos = Vec3.lerp(new Vec3(), this.track[pIdx], this.track[pIdx + 1], (dNeed - dCovered) / d);
                    if (s.active) {
                        s.worldPosition = pos;
                        let look = new Vec3(); Vec3.subtract(look, lastPos, pos);
                        if (look.length() > 0.01) {
                            let q = new Quat(); Quat.fromViewUp(q, look.normalize(), Vec3.UP);
                            Quat.multiply(q, q, Quat.fromEuler(new Quat(), 0, 180, 0));
                            s.worldRotation = q;
                        }
                    }
                    lastPos = pos.clone(); break;
                } else { dCovered += d; pIdx++; }
            }
        }
    }

    public getIsMoving(): boolean { return this.state !== SnakeState.IDLE; }
    onDestroy() { input.off(Input.EventType.TOUCH_START, this.onTouchStart, this); }
}