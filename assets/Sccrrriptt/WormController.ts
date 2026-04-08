import { _decorator, Component, Node, input, Input, EventTouch, Camera, Vec3, Vec2, Quat, director } from 'cc';
import { CirclePath } from './CirclePath';
import { Hole } from './Hole';
const { ccclass, property } = _decorator;

enum SnakeState { IDLE, GOING, RETURNING, ENTERING_HOLE }

@ccclass('WormController')
export class WormController extends Component {

    @property(Camera)
    mainCamera: Camera = null!;
    @property
    moveSpeed: number = 8;
    @property
    segmentSpacing: number = 0.28;
    @property
    sensingDistance: number = 0.6;
    @property(Hole)
    targetHole: Hole = null!; 
    @property(CirclePath)
    exitPath: CirclePath = null!; 
    @property
    snakeColor: string = "Grey"; // Use "Grey" to match your Hole Mappings image

    private headNode: Node = null!;
    private segments: Node[] = []; 
    private allParts: Node[] = [];
    private state: SnakeState = SnakeState.IDLE;
    private moveDirection: Vec3 = new Vec3();
    private track: Vec3[] = []; 
    private startPathSize: number = 0;
    private startPositions: Vec3[] = [];
    private startRotations: Quat[] = [];

    onLoad() {
        const children = this.node.children;
        if (children.length < 2) return;
        this.headNode = children[0];
        let unsortedSegments = children.slice(1);
        this.segments = []; 

        let currentPiece = this.headNode;
        while (unsortedSegments.length > 0) {
            let closestIndex = 0;
            let minDistance = 1000;
            for (let j = 0; j < unsortedSegments.length; j++) {
                let d = Vec3.distance(currentPiece.worldPosition, unsortedSegments[j].worldPosition);
                if (d < minDistance) { minDistance = d; closestIndex = j; }
            }
            let nextSegment = unsortedSegments[closestIndex];
            this.segments.push(nextSegment);
            unsortedSegments.splice(closestIndex, 1);
            currentPiece = nextSegment;
        }

        this.allParts = [this.headNode, ...this.segments];
        this.startPositions = this.allParts.map(p => p.worldPosition.clone());
        this.startRotations = this.allParts.map(p => p.worldRotation.clone());
        this.buildInitialPath();
    }

    private buildInitialPath() {
        this.track = [];
        for (let i = 0; i < this.allParts.length - 1; i++) {
            const a = this.allParts[i].worldPosition;
            const b = this.allParts[i + 1].worldPosition;
            const steps = 60;
            for (let t = 0; t < steps; t++) {
                this.track.push(Vec3.lerp(new Vec3(), a, b, t / steps));
            }
        }
        this.track.push(this.allParts[this.allParts.length-1].worldPosition.clone());
        this.startPathSize = this.track.length;
    }

    private forceResetToStart() {
        for (let i = 0; i < this.allParts.length; i++) {
            this.allParts[i].active = true; 
            this.allParts[i].setWorldPosition(this.startPositions[i]);
            this.allParts[i].setWorldRotation(this.startRotations[i]);
        }
        this.track = [];
        this.buildInitialPath();
        this.state = SnakeState.IDLE;
    }

    start() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    onTouchStart(event: EventTouch) {
        if (this.state !== SnakeState.IDLE) return;
        const touchPos = event.getLocation(); 
        for (const part of this.allParts) {
            const sPos = new Vec3();
            this.mainCamera.worldToScreen(part.worldPosition, sPos);
            if (Vec2.distance(touchPos, new Vec2(sPos.x, sPos.y)) < 25) {
                this.beginSlither();
                break;
            }
        }
    }

    private beginSlither() {
        Vec3.transformQuat(this.moveDirection, new Vec3(-1, 0, 0), this.headNode.worldRotation);
        this.moveDirection.normalize();
        this.state = SnakeState.GOING;
    }

    update(dt: number) {
        if (this.state === SnakeState.IDLE) return;

        if (this.state === SnakeState.GOING) {
            if (this.isObstacleAhead()) {
                this.state = SnakeState.RETURNING;
            } else {
                this.handleGoingLoop(dt);
            }
        } else if (this.state === SnakeState.ENTERING_HOLE) {
            this.handleEnteringLoop(dt);
        } else if (this.state === SnakeState.RETURNING) {
            for(let i=0; i<4; i++){
                if (this.track.length > this.startPathSize) {
                    this.track.shift();
                    this.headNode.worldPosition = this.track[0].clone();
                } else {
                    this.forceResetToStart();
                    return;
                }
            }
        }

        this.applyPathToBody();
    }

    private handleGoingLoop(dt: number) {
        let headPos = this.headNode.worldPosition.clone();
        let nextPos = headPos.add(this.moveDirection.clone().multiplyScalar(this.moveSpeed * dt));

        if (this.exitPath) {
            const center = this.exitPath.getCenter();
            const distToCenter = Vec3.distance(nextPos, center);

            if (distToCenter >= this.exitPath.radius - 0.1) {
                // Circle radius lock
                let radialVec = new Vec3();
                Vec3.subtract(radialVec, nextPos, center);
                radialVec.normalize().multiplyScalar(this.exitPath.radius);
                Vec3.add(nextPos, center, radialVec);

                this.moveDirection = this.exitPath.getTangentAt(nextPos);

                // Exit if Color matches current Hole
                if (this.targetHole && this.targetHole.canAccept(this.snakeColor)) {
                    const holeDir = new Vec3();
                    Vec3.subtract(holeDir, this.targetHole.node.worldPosition, center);
                    holeDir.y = 0; holeDir.normalize();

                    const headDir = new Vec3();
                    Vec3.subtract(headDir, nextPos, center);
                    headDir.y = 0; headDir.normalize();

                    if (Vec3.dot(holeDir, headDir) > 0.98) {
                        this.state = SnakeState.ENTERING_HOLE;
                        return;
                    }
                }
            }
        }

        this.headNode.worldPosition = nextPos;
        this.track.unshift(nextPos.clone());
        if (this.headNode.worldPosition.length() > 65) this.node.active = false;
    }

    private handleEnteringLoop(dt: number) {
        const holePos = this.targetHole.node.worldPosition;
        const currentPos = this.headNode.worldPosition;
        
        const dirToHole = new Vec3();
        Vec3.subtract(dirToHole, holePos, currentPos);

        // Move the Head logic (speed boosted slightly to zip into the hole)
        if (dirToHole.length() > 0.05) {
            dirToHole.normalize();
            const step = dirToHole.multiplyScalar(this.moveSpeed * 1.5 * dt);
            const next = currentPos.clone().add(step);
            this.headNode.worldPosition = next;
            this.track.unshift(next.clone());
        } else {
            // Pin the hidden head at center but continue unshifting coordinates 
            // so the trail continues to grow at that spot
            this.headNode.worldPosition = holePos.clone();
            this.track.unshift(holePos.clone());
        }

        // --- THE NATURAL VANISH ---
        // As long as parts enter the "Vortex", hide them
        const vanishThreshold = 0.22;
        if (this.headNode.active && Vec3.distance(this.headNode.worldPosition, holePos) < vanishThreshold) {
            this.headNode.active = false;
        }

        let allIn = !this.headNode.active;
        for (let seg of this.segments) {
            if (seg.active) {
                if (Vec3.distance(seg.worldPosition, holePos) < vanishThreshold) {
                    seg.active = false;
                } else {
                    allIn = false;
                }
            }
        }

        if (allIn) {
            this.node.active = false;
            if (this.targetHole) this.targetHole.onSnakeSorted();
        }
    }

    private isObstacleAhead(): boolean {
        const others = director.getScene()!.getComponentsInChildren(WormController);
        const sensor = this.headNode.worldPosition.clone().add(this.moveDirection.clone().multiplyScalar(0.5));
        for (let other of others) {
            if (other === this || !other.node.active) continue;
            for (let part of other.allParts) {
                const dx = sensor.x - part.worldPosition.x;
                const dz = sensor.z - part.worldPosition.z;
                if (Math.sqrt(dx * dx + dz * dz) < 0.35) {
                    const toOther = new Vec3();
                    Vec3.subtract(toOther, part.worldPosition, this.headNode.worldPosition);
                    const dot = Vec3.dot(this.moveDirection, toOther.normalize());
                    if (dot > 0.75) return true; 
                }
            }
        }
        return false;
    }

    private applyPathToBody() {
        let pIdx = 0;
        let lastNodePos = this.headNode.worldPosition;

        for (let i = 0; i < this.segments.length; i++) {
            const segment = this.segments[i];
            
            // Logic change: Process ALL segments, but only UPDATE position of visible ones
            // This ensures segments at the back find the right "breadcrump" distance
            let distCovered = 0;
            let targetFound = false;

            while (pIdx < this.track.length - 1) {
                const d = Vec3.distance(this.track[pIdx], this.track[pIdx + 1]);
                if (distCovered + d >= this.segmentSpacing) {
                    const ratio = (this.segmentSpacing - distCovered) / d;
                    const target = Vec3.lerp(new Vec3(), this.track[pIdx], this.track[pIdx + 1], ratio);
                    
                    if (segment.active) {
                        segment.worldPosition = target;
                        const dir = new Vec3();
                        Vec3.subtract(dir, lastNodePos, target);
                        if (dir.length() > 0.01) {
                            let rot = new Quat();
                            Quat.fromViewUp(rot, dir.normalize(), Vec3.UP);
                            let flip = new Quat();
                            Quat.fromEuler(flip, 0, 180, 0); 
                            Quat.multiply(rot, rot, flip);
                            segment.worldRotation = rot;
                        }
                    }
                    
                    lastNodePos = target.clone();
                    targetFound = true;
                    break;
                } else { distCovered += d; pIdx++; }
            }
        }
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }
}