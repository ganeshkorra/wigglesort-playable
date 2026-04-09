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
    

    // Failsafe tracking
    private holeEntryTime: number = 0;

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
    }

    start() { input.on(Input.EventType.TOUCH_START, this.onTouchStart, this); }

onTouchStart(event: EventTouch) {
    //  if (GameManager.instance) {
    //         GameManager.instance.onUserInteraction();
    //     }
  if (GameManager.instance) {
                    GameManager.instance.beginTimer();
                }
        if (this.state !== SnakeState.IDLE) return;

       if (TutorialHand.instance) {
            TutorialHand.instance.resetIdleTimer();
        }
        const touchPos = event.getLocation(); 
        for (const part of this.allParts) {
            const sPos = new Vec3();
            this.mainCamera.worldToScreen(part.worldPosition, sPos);
            
            if (Vec2.distance(touchPos, new Vec2(sPos.x, sPos.y)) < 25) {
                // START THE GAME TIMER ON FIRST SUCCESSFUL CLICK
              
                this.beginSlither();
                break;
            }
        }
    }
// Add this to WormController class
    public isIdle(): boolean {
        // IDLE is the index 0 in your enum SnakeState { IDLE, GOING... }
        return this.state === SnakeState.IDLE;
    }
private beginSlither() {
        Vec3.transformQuat(this.moveDirection, new Vec3(-1, 0, 0), this.headNode.worldRotation);
        this.moveDirection.normalize();
        this.state = SnakeState.GOING;
    }

    update(dt: number) {
        if (this.state === SnakeState.IDLE) return;

        if (this.state === SnakeState.GOING) {
            if (this.isObstacleAhead()) { this.state = SnakeState.RETURNING; }
            else { this.processGoingLogic(dt); }
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
// Helper for the tutorial hand to check if this snake is open
    public canSlitherOut(): boolean {
        // Calculate what the direction WOULD be if clicked
        let tempDir = new Vec3();
        Vec3.transformQuat(tempDir, new Vec3(-1, 0, 0), this.headNode.worldRotation);
        tempDir.normalize();

        const others = director.getScene()!.getComponentsInChildren(WormController);
        const sensor = this.headNode.worldPosition.clone().add(tempDir.clone().multiplyScalar(0.5));

        for (let other of others) {
            if (other === this || !other.node.active) continue;
            for (let part of other.allParts) {
                const dx = sensor.x - part.worldPosition.x;
                const dz = sensor.z - part.worldPosition.z;
                // If an obstacle is detected in the predicted path
                if (Math.sqrt(dx * dx + dz * dz) < 0.35) {
                    const toOther = new Vec3();
                    Vec3.subtract(toOther, part.worldPosition, this.headNode.worldPosition);
                    // Use the same Dot Product threshold from your movement code
                    if (Vec3.dot(tempDir, toOther.normalize()) > 0.75) {
                        return false; // It's blocked!
                    }
                }
            }
        }
        return true; // The path is clear!
    }

     public getIsMoving(): boolean {
        return this.state !== SnakeState.IDLE;
    }
    private processGoingLogic(dt: number) {
        let headPos = this.headNode.worldPosition.clone();
        let next = headPos.add(this.moveDirection.clone().multiplyScalar(this.moveSpeed * dt));

        if (this.exitPath) {
            const center = this.exitPath.getCenter();
            const dCenter = Vec3.distance(next, center);
            if (dCenter >= this.exitPath.radius - 0.1) {
                let rad = new Vec3(); Vec3.subtract(rad, next, center);
                rad.normalize().multiplyScalar(this.exitPath.radius);
                Vec3.add(next, center, rad); 
                this.moveDirection = this.exitPath.getTangentAt(next);

                if (this.targetHole && this.targetHole.canAccept(this.snakeColor)) {
                    let hDir = new Vec3(); Vec3.subtract(hDir, this.targetHole.node.worldPosition, center);
                    let sDir = new Vec3(); Vec3.subtract(sDir, next, center);
                    if (Vec3.dot(hDir.normalize(), sDir.normalize()) > 0.98) {
                        this.state = SnakeState.ENTERING_HOLE; 
                        this.holeEntryTime = 0; 
                        return;
                    }
                }
            }
        }
        this.headNode.worldPosition = next;
        this.track.unshift(next.clone());
        if (this.headNode.worldPosition.length() > 70) this.node.active = false;
    }

    private processForceEntry(dt: number) {
        this.holeEntryTime += dt;
        const holePos = this.targetHole.node.worldPosition;
        
        // 1. DIRECTIONAL VACUUM: Make the head zip TOWARD and THROUGH the hole
        let dirToHole = new Vec3();
        Vec3.subtract(dirToHole, holePos, this.headNode.worldPosition);
        
        // Boost speed while sucking into hole
        const vacuumSpeed = this.moveSpeed * 1.5;

        // Drive the hidden head even deeper so the path keeps pulling
        const step = dirToHole.length() < 0.1 ? 
                     this.moveDirection.clone().multiplyScalar(vacuumSpeed * dt) : 
                     dirToHole.normalize().multiplyScalar(vacuumSpeed * dt);

        const nextHeadPos = this.headNode.worldPosition.clone().add(step);
        this.headNode.worldPosition = nextHeadPos;
        this.track.unshift(nextHeadPos.clone());

        // 2. PIECE HIDING Logic
        const hideRadius = 0.35; // Looser radius ensures hide occurs easily
        if (this.headNode.active && Vec3.distance(this.headNode.worldPosition, holePos) < hideRadius) {
            this.headNode.active = false;
        }

        let finished = !this.headNode.active;
        for (let seg of this.segments) {
            if (seg.active) {
                if (Vec3.distance(seg.worldPosition, holePos) < hideRadius) {
                    seg.active = false;
                } else {
                    finished = false;
                }
            }
        }

        // 3. FAILSAFE: Force successful completion if logic takes too long (2.5 seconds max)
        if (finished || this.holeEntryTime > 2.5) {
            this.node.active = false;
            if (this.targetHole) this.targetHole.onSnakeSorted();
            console.log(this.snakeColor + " Forcefully Successfull!");
        }
    }

    private isObstacleAhead(): boolean {
        const others = director.getScene()!.getComponentsInChildren(WormController);
        const sensor = this.headNode.worldPosition.clone().add(this.moveDirection.clone().multiplyScalar(0.4));
        for (let other of others) {
            if (other === this || !other.node.active) continue;
            for (let part of other.allParts) {
                if (Vec3.distance(sensor, part.worldPosition) < 0.3) {
                    let toO = new Vec3(); Vec3.subtract(toO, part.worldPosition, this.headNode.worldPosition);
                    if (Vec3.dot(this.moveDirection, toO.normalize()) > 0.8) return true;
                }
            }
        }
        return false;
    }

    private applyPathToBody() {
        let pIdx = 0; let lastPos = this.headNode.worldPosition;
        for (let i = 0; i < this.segments.length; i++) {
            const s = this.segments[i];
            let dNeeded = this.segmentSpacing; let dCovered = 0;
            while (pIdx < this.track.length - 1) {
                const step = Vec3.distance(this.track[pIdx], this.track[pIdx + 1]);
                if (dCovered + step >= dNeeded) {
                    const r = (dNeeded - dCovered) / step;
                    const target = Vec3.lerp(new Vec3(), this.track[pIdx], this.track[pIdx + 1], r);
                    
                    if (s.active) {
                        s.worldPosition = target;
                        const dir = new Vec3(); Vec3.subtract(dir, lastPos, target);
                        if (dir.length() > 0.01) {
                            let q = new Quat(); Quat.fromViewUp(q, dir.normalize(), Vec3.UP);
                            Quat.multiply(q, q, Quat.fromEuler(new Quat(), 0, 180, 0));
                            s.worldRotation = q;
                        }
                    }
                    lastPos = target.clone();
                    break;
                } else { dCovered += step; pIdx++; }
            }
        }
    }

    onDestroy() { input.off(Input.EventType.TOUCH_START, this.onTouchStart, this); }
}