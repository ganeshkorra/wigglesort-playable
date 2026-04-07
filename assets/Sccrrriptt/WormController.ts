import { _decorator, Component, Node, input, Input, EventTouch, Camera, Vec3, Vec2, Quat, director } from 'cc';
const { ccclass, property } = _decorator;

enum SnakeState { IDLE, GOING, RETURNING }

@ccclass('WormController')
export class WormController extends Component {

    @property(Camera)
    mainCamera: Camera = null!;

    @property
    moveSpeed: number = 8;

    @property
    segmentSpacing: number = 0.28;

    @property
    sensingDistance: number = 0.6; // sensing obstacle radius

    private headNode: Node = null!;
    private segments: Node[] = []; 
    private allParts: Node[] = [];
    
    private state: SnakeState = SnakeState.IDLE;
    private moveDirection: Vec3 = new Vec3();
    
    // THE RECORDED TRACK
    private track: Vec3[] = []; 
    private startPathSize: number = 0;

    // EDITOR SNAPSHOTS
    private startPositions: Vec3[] = [];
    private startRotations: Quat[] = [];

    onLoad() {
        const children = this.node.children;
        if (children.length < 2) return;

        // 1. Isolate the Head
        this.headNode = children[0];
        
        // 2. Put all other children into a "Unsorted" list
        let unsortedSegments = children.slice(1);
        this.segments = []; // Clear the script's segment list to rebuild it

        // 3. SMART SORT LOGIC
        // We start at the head and look for the closest piece.
        let currentPiece = this.headNode;

        while (unsortedSegments.length > 0) {
            let closestIndex = 0;
            let minDistance = 1000;

            for (let j = 0; j < unsortedSegments.length; j++) {
                let d = Vec3.distance(currentPiece.worldPosition, unsortedSegments[j].worldPosition);
                if (d < minDistance) {
                    minDistance = d;
                    closestIndex = j;
                }
            }

            // We found the true "Next" segment in the snake's body
            let nextSegment = unsortedSegments[closestIndex];
            this.segments.push(nextSegment);
            
            // Remove it from unsorted and make it the new point to search from
            unsortedSegments.splice(closestIndex, 1);
            currentPiece = nextSegment;
        }

        this.allParts = [this.headNode, ...this.segments];

        // Capture the EXACT look of the snake from the Editor
        this.startPositions = this.allParts.map(p => p.worldPosition.clone());
        this.startRotations = this.allParts.map(p => p.worldRotation.clone());

        // Pre-record the editor path (the spiral)
        this.buildInitialPath();
    }

    private buildInitialPath() {
        this.track = [];
        for (let i = 0; i < this.allParts.length - 1; i++) {
            const a = this.allParts[i].worldPosition;
            const b = this.allParts[i + 1].worldPosition;
            const steps = 60; // Very high density
            for (let t = 0; t < steps; t++) {
                this.track.push(Vec3.lerp(new Vec3(), a, b, t / steps));
            }
        }
        this.track.push(this.allParts[this.allParts.length-1].worldPosition.clone());
        this.startPathSize = this.track.length;
    }

    private forceResetToStart() {
        // SNAP back to pixel-perfect Editor values
        for (let i = 0; i < this.allParts.length; i++) {
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
            if (Vec2.distance(touchPos, new Vec2(sPos.x, sPos.y)) < 9) {
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
                const step = this.moveDirection.clone().multiplyScalar(this.moveSpeed * dt);
                const nextPos = this.headNode.worldPosition.clone().add(step);
                this.headNode.worldPosition = nextPos;
                this.track.unshift(nextPos.clone());
            }
        } else if (this.state === SnakeState.RETURNING) {
            // RETURN MODE: Rewind the recorded track
            // Use 3 steps per frame to make it snap back fast
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
        
        if (this.state === SnakeState.GOING && this.headNode.worldPosition.length() > 60) {
            this.node.active = false;
        }
    }

   private isObstacleAhead(): boolean {
        const others = director.getScene()!.getComponentsInChildren(WormController);

        // This point is 0.5 units directly in front of the snake's mouth
        const sensorPoint = this.headNode.worldPosition.clone().add(this.moveDirection.clone().multiplyScalar(0.5));

        for (let other of others) {
            if (other === this || !other.node.active) continue;

            for (let part of other.allParts) {
                // 1. Check distance to sensor point
                const dx = sensorPoint.x - part.worldPosition.x;
                const dz = sensorPoint.z - part.worldPosition.z;
                const horizontalDist = Math.sqrt(dx * dx + dz * dz);

                // If a body part is very close to the "mouth sensor"...
                if (horizontalDist < 0.35) { // Narrower radius for narrow lanes
                    
                    // 2. ADDITIONAL CHECK: Is this part actually in FRONT?
                    // We calculate the vector from our head to the neighbor part
                    const toOther = new Vec3();
                    Vec3.subtract(toOther, part.worldPosition, this.headNode.worldPosition);
                    toOther.normalize();

                    // Calculate "Forwardness" (Dot Product)
                    // 1.0 means exactly in front, 0.0 means side, -1.0 means behind
                    const dot = Vec3.dot(this.moveDirection, toOther);

                    // Only stop if the part is in a 45-degree cone in front (dot > 0.7)
                    if (dot > 0.7) {
                        console.log("Blocking obstacle found in front!");
                        return true; 
                    }
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
            let distCovered = 0;

            while (pIdx < this.track.length - 1) {
                const d = Vec3.distance(this.track[pIdx], this.track[pIdx+1]);
                if (distCovered + d >= this.segmentSpacing) {
                    const ratio = (this.segmentSpacing - distCovered) / d;
                    const target = Vec3.lerp(new Vec3(), this.track[pIdx], this.track[pIdx+1], ratio);
                    segment.worldPosition = target;

                    // Direction
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
                    lastNodePos = target.clone();
                    break;
                } else {
                    distCovered += d;
                    pIdx++;
                }
            }
        }
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }
}