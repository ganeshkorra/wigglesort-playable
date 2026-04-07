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
    collisionRadius: number = 0.35; // Radius of sensing. Adjust based on your model size.

    private headNode: Node = null!;
    private segments: Node[] = []; 
    private allParts: Node[] = [];
    
    private state: SnakeState = SnakeState.IDLE;
    private moveDirection: Vec3 = new Vec3();
    private trail: Vec3[] = [];
    
    // Position to return to
    private startPosition: Vec3 = new Vec3();

    onLoad() {
        const children = this.node.children;
        if (children.length < 2) return;

        this.headNode = children[0];
        this.segments = children.slice(1);
        this.allParts = children;
        this.startPosition = this.headNode.worldPosition.clone();

        // Initial Road Setup
        this.initTrail();
    }

    private initTrail() {
        this.trail = [];
        for (let i = 0; i < this.allParts.length - 1; i++) {
            const start = this.allParts[i].worldPosition;
            const end = this.allParts[i + 1].worldPosition;
            for (let t = 0; t < 40; t++) {
                this.trail.push(Vec3.lerp(new Vec3(), start, end, t / 40));
            }
        }
        this.trail.push(this.allParts[this.allParts.length - 1].worldPosition.clone());
    }

    start() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    onTouchStart(event: EventTouch) {
        if (this.state !== SnakeState.IDLE) return;

        const touchPos = event.getLocation(); 
        let clickedMe = false;
        for (const part of this.allParts) {
            const screenPos = new Vec3();
            this.mainCamera.worldToScreen(part.worldPosition, screenPos);
            const dist = Vec2.distance(touchPos, new Vec2(screenPos.x, screenPos.y));
            if (dist < 15) { clickedMe = true; break; }
        }

        if (clickedMe) {
            Vec3.transformQuat(this.moveDirection, new Vec3(-1, 0, 0), this.headNode.worldRotation);
            this.moveDirection.normalize();
            this.state = SnakeState.GOING;
        }
    }

    update(dt: number) {
        if (this.state === SnakeState.IDLE) return;

        if (this.state === SnakeState.GOING) {
            this.handleGoing(dt);
            this.checkObstacles();
        } else if (this.state === SnakeState.RETURNING) {
            this.handleReturning(dt);
        }

        this.updateSegments();
        this.handleExit();
    }

    private handleGoing(dt: number) {
        const moveStep = this.moveDirection.clone().multiplyScalar(this.moveSpeed * dt);
        const newPos = this.headNode.worldPosition.clone().add(moveStep);
        this.headNode.worldPosition = newPos;
        this.trail.unshift(newPos.clone());
    }

    private handleReturning(dt: number) {
        // Move the head back towards start position
        const dirToHome = new Vec3();
        Vec3.subtract(dirToHome, this.startPosition, this.headNode.worldPosition);
        
        if (dirToHome.length() < 0.1) {
            // BACK HOME
            this.headNode.worldPosition = this.startPosition.clone();
            this.state = SnakeState.IDLE;
            this.initTrail(); // Reset trail to initial setup
            this.updateSegments();
            return;
        }

        dirToHome.normalize();
        const moveStep = dirToHome.multiplyScalar(this.moveSpeed * dt);
        this.headNode.worldPosition = this.headNode.worldPosition.add(moveStep);
        
        // Remove breadcrumbs as we go back
        if (this.trail.length > this.allParts.length * 10) {
            this.trail.shift();
        }
    }

    private checkObstacles() {
        // Find every other snake in the level
        const allSnakes = this.node.parent?.getComponentsInChildren(WormController);
        if (!allSnakes) return;

        for (let otherSnake of allSnakes) {
            if (otherSnake === this) continue; // Don't hit yourself

            // Check head against every part of the OTHER snake
            for (let part of otherSnake.allParts) {
                const dist = Vec3.distance(this.headNode.worldPosition, part.worldPosition);
                
                // If head gets too close to another snake's body
                if (dist < this.collisionRadius) {
                    console.log("Blocked! Returning to home...");
                    this.state = SnakeState.RETURNING;
                    return;
                }
            }
        }
    }

    private updateSegments() {
        let trailPtr = 0;
        let lastPos = this.headNode.worldPosition;

        for (let i = 0; i < this.segments.length; i++) {
            const segment = this.segments[i];
            let currentDist = 0;

            while (trailPtr < this.trail.length - 1) {
                const gap = Vec3.distance(this.trail[trailPtr], this.trail[trailPtr + 1]);
                if (currentDist + gap >= this.segmentSpacing) {
                    const ratio = (this.segmentSpacing - currentDist) / gap;
                    const pos = Vec3.lerp(new Vec3(), this.trail[trailPtr], this.trail[trailPtr + 1], ratio);
                    segment.worldPosition = pos;

                    // Face forward or backward depending on state
                    const lookDir = new Vec3();
                    Vec3.subtract(lookDir, lastPos, pos);
                    if (lookDir.length() > 0.001) {
                        let rot = new Quat();
                        Quat.fromViewUp(rot, lookDir.normalize(), Vec3.UP);
                        let flip = new Quat();
                        Quat.fromEuler(flip, 0, 180, 0); 
                        Quat.multiply(rot, rot, flip);
                        segment.worldRotation = rot;
                    }
                    
                    lastPos = pos.clone();
                    break;
                } else {
                    currentDist += gap;
                    trailPtr++;
                }
            }
        }
    }

    private handleExit() {
        if (this.state === SnakeState.GOING && this.headNode.worldPosition.length() > 60) {
            this.node.active = false; // Vanish when escaped
        }
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }
}