import { _decorator, Component, Node, Vec3, instantiate, Prefab, Quat, math, input, Input, EventMouse, EventTouch, geometry, Camera, MeshRenderer, Color, tween } from 'cc';
import { SnakePath } from './SnakePath';

const { ccclass, property } = _decorator;

// ─── Global launch queue ──────────────────────────────────────────────────────
const _launchQueue: Snake[] = [];
let   _currentlyJoining: Snake | null = null;

function enqueueSnake(snake: Snake) {
    if (_launchQueue.indexOf(snake) !== -1) return;
    _launchQueue.push(snake);
    // If something is already moving, freeze this one immediately
    if (_currentlyJoining && !_currentlyJoining.hasFinishedJoining()) {
        snake.freezeInPlace();
    }
    tryLaunchNext();
}

function tryLaunchNext() {
    if (_currentlyJoining && !_currentlyJoining.hasFinishedJoining()) return;
    _currentlyJoining = null;
    if (_launchQueue.length === 0) return;

    const next = _launchQueue.shift();
    if (!next || next.hasFailed() || next.isEnteringHole()) return;

    // Freeze all snakes still in queue
    for (const waiting of _launchQueue) {
        waiting.freezeInPlace();
    }

    _currentlyJoining = next;
    next.unfreezeInPlace();
    next.beginMoving();
}

function notifyJoinComplete(snake: Snake) {
    if (_currentlyJoining === snake) {
        _currentlyJoining = null;
        tryLaunchNext();
    }
}
// ─────────────────────────────────────────────────────────────────────────────

@ccclass('Snake')
export class Snake extends Component {

    @property(Prefab) headPrefab: Prefab = null;
    @property(Prefab) segmentPrefab: Prefab = null;
    @property segmentCount: number = 8;
    @property segmentSpacing: number = 0.45;
    @property headAttachOffset: number = 0.35;
    @property({ type: Node }) headTipNode: Node = null;
    @property moveSpeed: number = 2.0;
    @property wiggleAmount: number = 0.3;
    @property wiggleSpeed: number = 2.0;
    @property snakeColor: string = 'green';
    @property({ type: Node }) existingHead: Node = null;
    @property({ type: [Node] }) existingSegments: Node[] = [];
    @property({ type: Node }) pathNode: Node = null;
    @property autoStartOnPath: boolean = false;

    @property({ type: [Node], tooltip: 'Snakes that must start moving before this snake can be interacted with' })
    blockedBySnakes: Node[] = [];

    @property({ type: [Node], tooltip: 'Snakes physically blocking this snake\'s route to the path.' })
    frontBlockingSnakes: Node[] = [];

    @property({ tooltip: 'Minimum world-unit gap to maintain between snakes' })
    minSeparation: number = 0.8;

    @property({ tooltip: 'Extra clearance the LAST segment of the snake ahead must travel past the entry point' })
    tailClearance: number = 1.2;

    @property({ tooltip: 'How far ahead (world units) an on-path snake scans for a merging snake blocking its lane' })
    lookAheadDistance: number = 2.5;

    @property({ tooltip: 'Seconds a blocked snake waits before being marked failed.' })
    maxCollisionWaitTime: number = 0.1;

    // ── Internal state ────────────────────────────────────────────────────────
    private _isEntering: boolean = false;
    private _holePos: Vec3 = new Vec3();
    private _entryFinished: boolean = false;
    private _entryStartPos: Vec3 = new Vec3();
    private _entryDistTraveled: number = 0;
    private _onEntryComplete: (() => void) | null = null;
    private _moveStartTime: number = Infinity;
    private _hasFailed: boolean = false;
    private _collisionWaitTimer: number = 0;
    private _isFeedbackPlaying: boolean = false;
    private _feedbackTime: number = 0;
    private _feedbackBasePositions: Vec3[] = [];
    private _isBounceBack: boolean = false;
    private _bounceBackTimer: number = 0;
    private _bounceStartPos: Vec3 = new Vec3();
    private _bounceOriginalPose: Vec3[] = [];

    private _isJoining: boolean = true;
    private _hasFinishedJoining: boolean = false;
    private _bounceRetryCount: number = 0;
    private readonly MAX_BOUNCE_RETRIES: number = 3;
    private headNode: Node = null;
    private bodySegments: Node[] = [];
    private _isFrozenWaiting: boolean = false;
    private _frozenPose: Vec3[] = [];
    private _frozenRotations: Quat[] = [];
    private readonly HISTORY_SIZE = 512;
    private headHistory:  Vec3[]   = [];
    private headDistHist: number[] = [];
    private headHistIdx:  number   = 0;
    private totalDist:    number   = 0;

    private time:          number = 0;
    private phaseOffset:   number = 0;
    private lastTravelDir: Vec3   = new Vec3(0, 0, 1);
    private _noSpaceOnClick: boolean = false;
    private snakePath: SnakePath = null;
    private currentPathDistance: number = 0;
    private isMoving: boolean = false;
    private pathTangent: Vec3 = new Vec3(0, 0, 1);
    private isOnPath: boolean = false;
    private targetPathPoint: Vec3 = new Vec3();
    private segmentLags: number[] = [];

    private _bounceOriginalRotations: Quat[] = [];
    private isSelected: boolean = false;
    private lastClickTime: number = 0;

    private readonly CLICK_DEBOUNCE_MS = 300;
    private _bounceReversing: boolean = false;
    private _bounceOriginalHistory: Vec3[] = [];
    private _bounceOriginalHistDist: number[] = [];
    private _bounceOriginalTotalDist: number = 0;
    private _bounceOriginalHistIdx: number = 0;
    private _bouncePhase2StartPose: Vec3[] = [];
    private _bouncePhase2Progress: number = 0;
    private _bouncePhase2StartRotations: Quat[] = [];

    // ─────────────────────────────────────────────────────────────────────────
    get isJoining(): boolean { return this._isJoining; }
    hasFinishedJoining(): boolean { return this._hasFinishedJoining; }

    // ─────────────────────────────────────────────────────────────────────────
    start() {
        this.phaseOffset = Math.random() * Math.PI * 2;
        this.createSnake();
        this.seedHistory();
        if (this.pathNode) this.snakePath = this.pathNode.getComponent(SnakePath);
        this.setupInput();
        if (this.autoStartOnPath) this.startMoving();
    }

    private setupInput() {
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    onDestroy() {
        this.unfreezeInPlace();
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        const qi = _launchQueue.indexOf(this);
        if (qi !== -1) _launchQueue.splice(qi, 1);
        if (_currentlyJoining === this) {
            _currentlyJoining = null;
            tryLaunchNext();
        }
    }

    private onMouseDown(e: EventMouse) { this.checkClick(e.getLocationX(), e.getLocationY()); }
    private onTouchStart(e: EventTouch) {
        const t = e.getTouches()[0];
        this.checkClick(t.getLocationX(), t.getLocationY());
    }

    private checkClick(sx: number, sy: number) {
        const cam = this.findMainCamera();
        if (!cam) return;
        const ray = cam.screenPointToRay(sx, sy);
        if (this.checkRayIntersection(ray, this.headNode)) { this.onSnakeClicked(); return; }
        for (const seg of this.bodySegments) {
            if (this.checkRayIntersection(ray, seg)) { this.onSnakeClicked(); return; }
        }
    }

    private findMainCamera(): Camera | null {
        const n = this.node.scene?.getChildByName('Camera') || this.node.scene?.getChildByName('Main Camera');
        return n ? n.getComponent(Camera) : null;
    }

    private checkRayIntersection(ray: geometry.Ray, target: Node | null): boolean {
        if (!target?.active) return false;
        const wp = target.getWorldPosition();
        const tp = new Vec3();
        Vec3.subtract(tp, wp, ray.o);
        const t = Vec3.dot(tp, ray.d);
        if (t < 0) return false;
        const cl = new Vec3();
        Vec3.scaleAndAdd(cl, ray.o, ray.d, t);
        const dv = new Vec3();
        Vec3.subtract(dv, cl, wp);
        return Vec3.dot(dv, dv) < 0.2;
    }

    // ── FIX 1: freezeInPlace / unfreezeInPlace — restore pose immediately and every frame ──
    freezeInPlace() {
        if (this._isFrozenWaiting) return;
        this._isFrozenWaiting = true;
        this._frozenPose = [];
        this._frozenRotations = [];
        if (this.headNode) {
            this._frozenPose.push(this.headNode.getWorldPosition().clone());
            this._frozenRotations.push(this.headNode.getWorldRotation().clone());
        }
        for (const seg of this.bodySegments) if (seg) {
            this._frozenPose.push(seg.getWorldPosition().clone());
            this._frozenRotations.push(seg.getWorldRotation().clone());
        }
        // Apply immediately so there is zero drift even on the frame we freeze
        this._applyFrozenPose();
    }

    unfreezeInPlace() {
        if (!this._isFrozenWaiting) return;
        this._isFrozenWaiting = false;
        // Restore exact pose so no drift accumulated while frozen
        this._applyFrozenPose();
        this._frozenPose = [];
        this._frozenRotations = [];
    }

    /** Shared helper — writes the stored frozen pose back to every node. */
    private _applyFrozenPose() {
        const nodes: Node[] = [];
        if (this.headNode) nodes.push(this.headNode);
        for (const seg of this.bodySegments) if (seg) nodes.push(seg);
        for (let i = 0; i < nodes.length && i < this._frozenPose.length; i++) {
            nodes[i].setWorldPosition(this._frozenPose[i]);
            nodes[i].setWorldRotation(this._frozenRotations[i]);
        }
    }

    playWiggleFeedback() {
        if (this._isFeedbackPlaying) return;
        if (this.isMoving || this._isEntering || this._entryFinished || this._hasFailed) return;
        this._feedbackBasePositions = [];
        if (this.headNode?.active)
            this._feedbackBasePositions.push(this.headNode.getWorldPosition().clone());
        for (const seg of this.bodySegments)
            if (seg?.active) this._feedbackBasePositions.push(seg.getWorldPosition().clone());
        this._feedbackTime = 0;
        this._isFeedbackPlaying = true;
    }

    private tickFeedbackWiggle() {
        const duration  = 0.75;
        const freq      = 10.0;
        const amp       = 0.05;
        const phaseStep = 1.1;
        const envelope = Math.sin(Math.PI * this._feedbackTime / duration);

        const nodes: Node[] = [];
        if (this.headNode?.active) nodes.push(this.headNode);
        for (const seg of this.bodySegments) if (seg?.active) nodes.push(seg);

        for (let i = 0; i < nodes.length && i < this._feedbackBasePositions.length; i++) {
            const base   = this._feedbackBasePositions[i];
            const offset = Math.sin(this._feedbackTime * freq - i * phaseStep) * amp * envelope;
            nodes[i].setWorldPosition(base.x, base.y, base.z + offset);
        }
    }

    private stopFeedbackWiggle() {
        this._isFeedbackPlaying = false;
        this._feedbackTime = 0;
        const nodes: Node[] = [];
        if (this.headNode?.active) nodes.push(this.headNode);
        for (const seg of this.bodySegments) if (seg?.active) nodes.push(seg);
        for (let i = 0; i < nodes.length && i < this._feedbackBasePositions.length; i++)
            nodes[i].setWorldPosition(this._feedbackBasePositions[i]);
        this._feedbackBasePositions = [];
    }

    isLocked(): boolean {
        for (const blockerNode of this.blockedBySnakes) {
            if (!blockerNode || !blockerNode.isValid) continue;
            const blocker = blockerNode.getComponent(Snake);
            if (!blocker) continue;
            const cleared = blocker._moveStartTime !== Infinity
                || blocker._isEntering
                || blocker._entryFinished
                || blocker._hasFailed;
            if (!cleared) return true;
        }
        return false;
    }

    private onSnakeClicked() {
        const now = Date.now();
        if (now - this.lastClickTime < this.CLICK_DEBOUNCE_MS) return;
        this.lastClickTime = now;

        this._emitSceneEvent('sfx-snake-tap');

        if (this.isLocked()) {
            this._emitSceneEvent('sfx-snake-wrong-tap');
            this.playWiggleFeedback();
            this.node.emit('snake-locked', { snake: this });
            return;
        }

        this.isSelected = !this.isSelected;

        if (this.isMoving) {
            this.stopMoving();
            this.unfreezeInPlace();
            const qi = _launchQueue.indexOf(this);
            if (qi !== -1) _launchQueue.splice(qi, 1);
            if (_currentlyJoining === this) {
                _currentlyJoining = null;
                tryLaunchNext();
            }
        } else {
            if (this.isFrontBlocked()) {
                this._emitSceneEvent('sfx-snake-wrong-tap');
                this.triggerBounceBack();
                this.node.emit('snake-front-blocked', { snake: this });
            } else {
                enqueueSnake(this);
            }
        }

        this.node.emit('snake-clicked', { snake: this, selected: this.isSelected, moving: this.isMoving });
    }

    private _emitSceneEvent(eventName: string): void {
        let n: Node = this.node;
        while (n.parent) {
            n = n.parent;
            n.emit(eventName, { snake: this });
        }
    }

    // ── Color ─────────────────────────────────────────────────────────────────
    private getSnakeColor(): Color {
        switch (this.snakeColor.toLowerCase()) {
            case 'red':    return new Color(230,  50,  60, 255);
            case 'blue':   return new Color( 70, 140, 220, 255);
            case 'green':  return new Color( 80, 200,  60, 255);
            case 'yellow': return new Color(240, 210,  30, 255);
            case 'purple': return new Color(140,  80, 210, 255);
            case 'orange': return new Color(255, 140,  30, 255);
            case 'pink':   return new Color(240,  80, 160, 255);
            case 'cyan':   return new Color( 60, 210, 210, 255);
            case 'brown':  return new Color(160,  90,  40, 255);
            case 'grey': case 'gray': return new Color(150, 150, 160, 255);
            default:       return new Color( 80, 200,  60, 255);
        }
    }

    private applyColor(node: Node | null, color: Color) {
        if (!node) return;
        const r = node.getComponent(MeshRenderer);
        if (r?.material) r.material.setProperty('mainColor', color);
    }

    // ── Construction ──────────────────────────────────────────────────────────
    private createSnake() {
        if (this.existingHead) {
            this.headNode = this.existingHead;
        } else if (this.headPrefab) {
            this.headNode = instantiate(this.headPrefab);
            this.headNode.setParent(this.node);
            this.headNode.setPosition(Vec3.ZERO);
        } else {
            this.headNode = this.node.getChildByPath('Head')
                || this.node.children.find(c => c.name.toLowerCase().includes('head'));
        }

        if (this.existingSegments.length > 0) {
            this.bodySegments = [...this.existingSegments];
        } else if (this.node.children.length <= 1) {
            for (let i = 0; i < this.segmentCount; i++) {
                if (this.segmentPrefab) {
                    const seg = instantiate(this.segmentPrefab);
                    seg.setParent(this.node);
                    seg.setPosition(Vec3.ZERO);
                    this.bodySegments.push(seg);
                }
            }
        } else {
            this.bodySegments = this.node.children.filter(c => c !== this.headNode);
        }
    }

    // ── History ───────────────────────────────────────────────────────────────
    private seedHistory() {
        const hp  = this.headNode ? this.headNode.getWorldPosition() : this.node.getWorldPosition();
        const len = this.segmentSpacing * (this.bodySegments.length + 2);
        for (let i = 0; i < this.HISTORY_SIZE; i++) {
            const frac   = i / (this.HISTORY_SIZE - 1);
            const behind = (1 - frac) * len;
            this.headHistory[i]  = new Vec3(
                hp.x - this.lastTravelDir.x * behind, hp.y,
                hp.z - this.lastTravelDir.z * behind);
            this.headDistHist[i] = frac * len;
        }
        this.headHistIdx = this.HISTORY_SIZE - 1;
        this.totalDist   = len;
    }

    private seedHistoryFromCurrentPose() {
        if (!this.headNode) return;
        const keys: Vec3[] = [this.headNode.getWorldPosition().clone()];
        for (const s of this.bodySegments) if (s) keys.push(s.getWorldPosition().clone());

        const dists: number[] = [0];
        for (let i = 1; i < keys.length; i++)
            dists.push(dists[i - 1] + Vec3.distance(keys[i - 1], keys[i]));

        const total = dists[dists.length - 1] || (this.segmentSpacing * this.bodySegments.length);
        this.headHistory  = new Array(this.HISTORY_SIZE);
        this.headDistHist = new Array(this.HISTORY_SIZE);

        for (let i = 0; i < this.HISTORY_SIZE; i++) {
            const frac   = i / (this.HISTORY_SIZE - 1);
            const behind = (1 - frac) * total;
            let pos: Vec3;
            if (keys.length === 1 || behind <= 0) {
                pos = keys[0].clone();
            } else {
                let acc = 0;
                pos = keys[keys.length - 1].clone();
                for (let k = 1; k < keys.length; k++) {
                    const sl = dists[k] - dists[k - 1];
                    if (acc + sl >= behind) {
                        const t = sl > 0.0001 ? (behind - acc) / sl : 0;
                        pos = new Vec3();
                        Vec3.lerp(pos, keys[k - 1], keys[k], t);
                        break;
                    }
                    acc += sl;
                }
            }
            this.headHistory[i]  = pos;
            this.headDistHist[i] = frac * total;
        }
        this.headHistIdx = this.HISTORY_SIZE - 1;
        this.totalDist   = total;
    }

    // ── Update ────────────────────────────────────────────────────────────────
    update(deltaTime: number) {
        if (this._entryFinished || this._hasFailed) return;

        // ── FIX 1: Frozen check FIRST — before anything else moves nodes ──────
        if (this._isFrozenWaiting) {
            this._applyFrozenPose();
            return;
        }

        this.time += deltaTime;
        if (!this.headNode) return;

        const prevPos = this.headNode.getWorldPosition();
        let newPos    = new Vec3();
        let step      = this.moveSpeed * deltaTime;

        if (this._isEntering) {
            this._entryDistTraveled += step;
            const toHole   = new Vec3();
            Vec3.subtract(toHole, this._holePos, this._entryStartPos);
            const totalEntry = toHole.length();

            if (this._entryDistTraveled < totalEntry) {
                const t    = this._entryDistTraveled / totalEntry;
                const base = new Vec3();
                Vec3.lerp(base, this._entryStartPos, this._holePos, t);
                const tang = new Vec3();
                Vec3.subtract(tang, this._holePos, this._entryStartPos);
                Vec3.normalize(tang, tang);
                const perp = new Vec3(-tang.z, 0, tang.x);
                const w    = Math.sin((this.time + this.phaseOffset) * this.wiggleSpeed) * this.wiggleAmount;
                newPos.set(base.x + perp.x * w, base.y, base.z + perp.z * w);
            } else {
                newPos.set(this._holePos);
                if (this.headNode.active) this.headNode.active = false;
            }

        } else {
            if (this._isFeedbackPlaying) {
                this._feedbackTime += deltaTime;
                this.tickFeedbackWiggle();
                if (this._feedbackTime >= 0.75) this.stopFeedbackWiggle();
            }
            if (!this.isMoving) return;

            if (this._isBounceBack) {
                newPos = this.computeBounceBackPosition(deltaTime);
                step   = Vec3.distance(prevPos, newPos);
                if (this._bounceReversing) {
                    this.headNode.setWorldPosition(newPos);
                    return;
                }
            } else {
                // ── Collision gating ─────────────────────────────────────────
                const blockedByEntryTail = this._isJoining && this.joiningTailClearanceBlocked();
                const blocked = !this._noSpaceOnClick && (
                    this.isBlockedAhead() || blockedByEntryTail
                );

                if (blocked) {
                    this._collisionWaitTimer += deltaTime;

                    const nearEntryPoint = this._isJoining
                        && this.headNode
                        && this.targetPathPoint.lengthSqr() > 0
                        && Vec3.distance(this.headNode.getWorldPosition(), this.targetPathPoint)
                            <= (this.minSeparation + this.segmentSpacing);

                    if (blockedByEntryTail && nearEntryPoint && !this.canFitOnPath()) {
                        // Only a snake that is actively entering a hole will free path space.
                        // Snakes merely circling the path do NOT free space.
                        const snakeEnteringHole = this.getAllSnakes().some(other => {
                            if (other === this) return false;
                            if (other._hasFailed || other._entryFinished) return false;
                            return other._isEntering;
                        });

                        const waitThreshold = snakeEnteringHole ? 0.6 : 1.5;
                        if (this._collisionWaitTimer < waitThreshold) {
                            return;
                        }

                        this.triggerFailedInstant();
                        return;
                    }
                    return;
                }
                this._collisionWaitTimer = 0;

                newPos = this.computeHeadPosition(deltaTime);
                step   = Vec3.distance(prevPos, newPos);
            }
        }

        if (this._entryFinished || this._hasFailed) return;

        // ── Advance history ──────────────────────────────────────────────────
        this.totalDist   += step;
        this.headHistIdx  = (this.headHistIdx + 1) % this.HISTORY_SIZE;
        this.headHistory[this.headHistIdx]  = newPos.clone();
        this.headDistHist[this.headHistIdx] = this.totalDist;

        if (this.headNode.active) {
            const dir = new Vec3();
            if (this._isJoining || !this.isOnPath) {
                Vec3.subtract(dir, newPos, prevPos);
            } else {
                const lb     = Math.min(0.3, this.totalDist * 0.15);
                const behind = this.sampleHistory(this.totalDist - lb);
                Vec3.subtract(dir, newPos, behind);
            }
            if (dir.lengthSqr() > 0.000001) {
                Vec3.normalize(dir, dir);
                Vec3.lerp(this.lastTravelDir, this.lastTravelDir, dir, 0.25);
                Vec3.normalize(this.lastTravelDir, this.lastTravelDir);
                if (!this._isBounceBack) {
                    this.faceDirection(this.headNode, this.lastTravelDir);
                }
            }
            this.headNode.setWorldPosition(newPos);
        }

        // ── Body segments ────────────────────────────────────────────────────
        if (this.segmentLags.length === 0) return;

        let allGone = (this.headNode.active === false);
        for (let i = 0; i < this.bodySegments.length; i++) {
            const seg     = this.bodySegments[i];
            if (!seg.active) continue;

            const lagDist = this.totalDist - this.segmentLags[i];
            const segPos  = this.sampleHistory(lagDist);
            seg.setWorldPosition(segPos);

            const lb      = Math.min(0.3, this.totalDist * 0.15);
            const segBack = this.sampleHistory(lagDist - lb);
            const segDir  = new Vec3();
            Vec3.subtract(segDir, segPos, segBack);
            if (segDir.lengthSqr() > 0.000001) {
                Vec3.normalize(segDir, segDir);
                this.faceDirection(seg, segDir, 90);
            }

            if (this._isEntering) {
                if (Vec3.distance(segPos, this._holePos) < 0.1) seg.active = false;
                else allGone = false;
            } else {
                allGone = false;
            }
        }

        if (this._isEntering && allGone) {
            this._entryFinished = true;
            if (this._onEntryComplete) this._onEntryComplete();
            this.node.destroy();
        }
    }

    // ── Collision checks ──────────────────────────────────────────────────────
    private isBlockedAhead(): boolean {
        if (!this.headNode) return false;
        const myHead = this.headNode.getWorldPosition();
        const fwd    = new Vec3(this.lastTravelDir.x, 0, this.lastTravelDir.z);
        Vec3.normalize(fwd, fwd);

        for (const other of this.getAllSnakes()) {
            if (!this.isValidObstacle(other)) continue;
            if (this.isOnPath && other._isJoining) continue;

            for (const child of other.node.children) {
                if (!child.active) continue;

                const toChild = new Vec3();
                Vec3.subtract(toChild, child.getWorldPosition(), myHead);
                toChild.y = 0;
                const dist = toChild.length();
                if (dist < 0.001) continue;

                if (dist < this.minSeparation) return true;

                if (dist <= this.segmentSpacing * 1.5) {
                    const norm = new Vec3();
                    Vec3.normalize(norm, toChild);
                    if (Vec3.dot(norm, fwd) > 0.6) return true;
                }
            }
        }
        return false;
    }

    private joiningTailClearanceBlocked(): boolean {
        const myEntry = this.targetPathPoint;
        for (const other of this.getAllSnakes()) {
            if (!this.isValidObstacle(other)) continue;
            if (other._isJoining) continue;

            const tail = other.bodySegments.length > 0
                ? other.bodySegments[other.bodySegments.length - 1]
                : other.headNode;
            if (!tail?.active) continue;

            if (Vec3.distance(tail.getWorldPosition(), myEntry) < this.minSeparation) {
                return true;
            }
        }
        return false;
    }

    private isValidObstacle(other: Snake): boolean {
        if (other === this)                    return false;
        if (other._isEntering)                 return false;
        if (other._entryFinished)              return false;
        if (other._hasFailed)                  return false;
        if (other._moveStartTime === Infinity) return false;
        if (other._isBounceBack)               return false;
        if (this._isJoining && other._isJoining) return false;
        return true;
    }

    isFrontBlocked(): boolean {
        for (const bn of this.frontBlockingSnakes) {
            if (!bn?.isValid) continue;
            const blocker = bn.getComponent(Snake);
            if (!blocker) continue;
            const cleared = blocker._moveStartTime !== Infinity
                || blocker._isEntering
                || blocker._entryFinished
                || blocker._hasFailed;
            if (!cleared) return true;
        }
        return false;
    }

    private triggerBounceBack() {
        if (this._isBounceBack || !this.snakePath || !this.headNode) return;

        this._bounceOriginalPose = [];
        if (this.headNode) this._bounceOriginalPose.push(this.headNode.getWorldPosition().clone());
        for (const seg of this.bodySegments) if (seg) this._bounceOriginalPose.push(seg.getWorldPosition().clone());
        this._bounceStartPos.set(this.headNode.getWorldPosition());
        this._bounceOriginalRotations = [];
        if (this.headNode) this._bounceOriginalRotations.push(this.headNode.getWorldRotation().clone());
        for (const seg of this.bodySegments) if (seg) this._bounceOriginalRotations.push(seg.getWorldRotation().clone());

        this._bounceOriginalHistory   = this.headHistory.map(v => v.clone());
        this._bounceOriginalHistDist  = [...this.headDistHist];
        this._bounceOriginalTotalDist = this.totalDist;
        this._bounceOriginalHistIdx   = this.headHistIdx;

        this.currentPathDistance = this.snakePath.getClosestDistance(this.headNode.getWorldPosition());
        this.targetPathPoint     = this.snakePath.getPointAtDistance(this.currentPathDistance);
        this._moveStartTime      = Date.now();
        this.isOnPath            = false;
        this._isJoining          = true;
        this._hasFinishedJoining = false;
        this._bounceReversing    = false;
        this._bouncePhase2Progress = 0;
        this._bouncePhase2StartPose = [];
        this.segmentLags         = this.bodySegments.map((_, i) => this.segmentSpacing * (i + 1));
        this.seedHistoryFromCurrentPose();
        this.isMoving       = true;
        this._isBounceBack  = true;
        this._bounceBackTimer = 0;
    }

    private computeBounceBackPosition(deltaTime: number): Vec3 {
        const cur  = this.headNode!.getWorldPosition();
        const move = this.moveSpeed * deltaTime;

        // ── Phase 1: lunge toward path entry ────────────────────────────────
        if (!this._bounceReversing) {
            this._bounceBackTimer += deltaTime;

            for (const bn of this.frontBlockingSnakes) {
                if (!bn?.isValid) continue;
                const blocker = bn.getComponent(Snake);
                if (!blocker) continue;
                const cleared = blocker._moveStartTime !== Infinity
                    || blocker._isEntering || blocker._entryFinished || blocker._hasFailed;
                if (cleared) continue;
                for (const child of blocker.node.children) {
                    if (!child?.active) continue;
                    if (Vec3.distance(cur, child.getWorldPosition()) < this.minSeparation) {
                        // ── FIX 3: call failed immediately, no scheduleOnce delay ──
                        if (this._noSpaceOnClick) {
                            this.triggerFailedWithPopup();
                            return cur.clone();
                        }
                        this.beginPhase2(cur);
                        return cur.clone();
                    }
                }
            }

            const toTarget = new Vec3();
            Vec3.subtract(toTarget, this.targetPathPoint, cur);
            toTarget.y = 0;
            if (toTarget.length() <= move || this._bounceBackTimer >= 0.35) {
                if (this._noSpaceOnClick) {
                    this.triggerFailedWithPopup();
                    return cur.clone();
                }
                this.beginPhase2(cur);
                return cur.clone();
            }

            Vec3.normalize(toTarget, toTarget);
            const r = new Vec3();
            Vec3.scaleAndAdd(r, cur, toTarget, move);
            return r;
        }

        // ── Phase 2: lerp entire snake back to original pose ────────────────
        const totalReturnDist = Vec3.distance(this._bouncePhase2StartPose[0], this._bounceOriginalPose[0]);
        const progressStep    = totalReturnDist > 0.001
            ? (move / totalReturnDist)
            : 1.0;
        this._bouncePhase2Progress = Math.min(1.0, this._bouncePhase2Progress + progressStep);

        const t = this.easeInOut(this._bouncePhase2Progress);
        const nodes: Node[] = [];
        if (this.headNode) nodes.push(this.headNode);
        for (const seg of this.bodySegments) if (seg) nodes.push(seg);

        for (let i = 1; i < nodes.length && i < this._bouncePhase2StartPose.length; i++) {
            const lerpedPos = new Vec3();
            Vec3.lerp(lerpedPos, this._bouncePhase2StartPose[i], this._bounceOriginalPose[i], t);
            nodes[i].setWorldPosition(lerpedPos);

            if (i < this._bouncePhase2StartRotations.length && i < this._bounceOriginalRotations.length) {
                const lerpedRot = new Quat();
                Quat.slerp(lerpedRot, this._bouncePhase2StartRotations[i], this._bounceOriginalRotations[i], t);
                nodes[i].setWorldRotation(lerpedRot);
            }
        }

        if (this._bouncePhase2Progress >= 1.0) {
            this.stopBounceBack();
            return this._bounceOriginalPose[0].clone();
        }

        const headPos = new Vec3();
        Vec3.lerp(headPos, this._bouncePhase2StartPose[0], this._bounceOriginalPose[0], t);

        if (this._bouncePhase2StartRotations.length > 0 && this._bounceOriginalRotations.length > 0) {
            const lerpedRot = new Quat();
            Quat.slerp(lerpedRot, this._bouncePhase2StartRotations[0], this._bounceOriginalRotations[0], t);
            this.headNode!.setWorldRotation(lerpedRot);
        }

        return headPos;
    }

    private beginPhase2(currentHeadPos: Vec3) {
        this._bounceReversing      = true;
        this._bouncePhase2Progress = 0;
        this._bouncePhase2StartPose = [];
        this._bouncePhase2StartRotations = [];
        if (this.headNode) {
            this._bouncePhase2StartPose.push(this.headNode.getWorldPosition().clone());
            this._bouncePhase2StartRotations.push(this.headNode.getWorldRotation().clone());
        }
        for (const seg of this.bodySegments) if (seg) {
            this._bouncePhase2StartPose.push(seg.getWorldPosition().clone());
            this._bouncePhase2StartRotations.push(seg.getWorldRotation().clone());
        }
    }

    private easeInOut(t: number): number {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    // ── FIX 3: triggerFailedWithPopup — call directly, no delay ──────────────
    private triggerFailedWithPopup(): void {
        if (this._hasFailed) return;
        this._hasFailed = true;
        this.isMoving   = false;
        this._isBounceBack = false;
        this.unfreezeInPlace();
        this.setSnakeColor('grey');
        console.warn(`[Snake] "${this.node.name}" failed – no space on path.`);

        this.node.emit('snake-failed', { snake: this });
        this.node.scene?.emit('force-fail-now', { snake: this });

        // Bubble up through the scene hierarchy so any Canvas listener catches it
        let n: Node = this.node;
        while (n.parent) {
            n = n.parent;
            n.emit('show-failed-screen', { snake: this });
        }

        if (_currentlyJoining === this) {
            _currentlyJoining = null;
            tryLaunchNext();
        }
    }

    private stopBounceBack() {
        this._isBounceBack         = false;
        this._bounceBackTimer      = 0;
        this._bounceReversing      = false;
        this._bouncePhase2Progress = 0;
        this.isMoving              = false;
        this.isOnPath              = false;
        this._isJoining            = true;
        this._hasFinishedJoining   = false;
        this._moveStartTime        = Infinity;
        this._noSpaceOnClick       = false;
        this._bounceRetryCount     = 0;

        this.headHistory    = this._bounceOriginalHistory.map(v => v.clone());
        this.headDistHist   = [...this._bounceOriginalHistDist];
        this.totalDist      = this._bounceOriginalTotalDist;
        this.headHistIdx    = this._bounceOriginalHistIdx;

        const nodes: Node[] = [];
        if (this.headNode) nodes.push(this.headNode);
        for (const seg of this.bodySegments) if (seg) nodes.push(seg);
        for (let i = 0; i < nodes.length && i < this._bounceOriginalPose.length; i++) {
            nodes[i].setWorldPosition(this._bounceOriginalPose[i]);
            if (i < this._bounceOriginalRotations.length)
                nodes[i].setWorldRotation(this._bounceOriginalRotations[i]);
        }

        this._bounceOriginalPose         = [];
        this._bounceOriginalHistory      = [];
        this._bounceOriginalHistDist     = [];
        this._bouncePhase2StartPose      = [];
        this._bouncePhase2StartRotations = [];
        this._bounceOriginalRotations    = [];
    }

    private getAllSnakes(): Snake[] {
        return this.node.scene.getComponentsInChildren(Snake);
    }

    // ── Movement ──────────────────────────────────────────────────────────────
    private computeHeadPosition(deltaTime: number): Vec3 {
        const cur = this.headNode!.getWorldPosition();

        if (!this.isOnPath) {
            const toTarget = new Vec3();
            Vec3.subtract(toTarget, this.targetPathPoint, cur);
            toTarget.y = 0;
            const dist = toTarget.length();
            const move = this.moveSpeed * deltaTime;

            if (dist <= move) {
                this.isOnPath            = true;
                this._isJoining          = false;
                this._hasFinishedJoining = true;
                this.currentPathDistance = this.snakePath!.getClosestDistance(cur);
                notifyJoinComplete(this);
                return this.targetPathPoint.clone();
            }

            Vec3.normalize(toTarget, toTarget);
            const r = new Vec3();
            Vec3.scaleAndAdd(r, cur, toTarget, move);
            return r;
        }

        if (this.snakePath) {
            this.currentPathDistance += this.moveSpeed * deltaTime;
            const base = this.snakePath.getPointAtDistance(this.currentPathDistance);
            const tang = this.snakePath.getTangentAtDistance(this.currentPathDistance);
            this.pathTangent = tang;
            const perp = new Vec3(-tang.z, 0, tang.x);
            const w    = Math.sin((this.time + this.phaseOffset) * this.wiggleSpeed) * this.wiggleAmount;
            return new Vec3(base.x + perp.x * w, base.y, base.z + perp.z * w);
        }

        return cur;
    }

    // ── History sampling ──────────────────────────────────────────────────────
    private sampleHistory(targetDist: number): Vec3 {
        const oldest = (this.headHistIdx + 1) % this.HISTORY_SIZE;
        if (targetDist <= this.headDistHist[oldest]) return this.headHistory[oldest].clone();

        let idx = this.headHistIdx;
        for (let s = 0; s < this.HISTORY_SIZE - 1; s++) {
            const prev = (idx - 1 + this.HISTORY_SIZE) % this.HISTORY_SIZE;
            if (this.headDistHist[prev] <= targetDist) {
                const d0 = this.headDistHist[prev], d1 = this.headDistHist[idx];
                const t  = (d1 - d0) > 0.0001 ? (targetDist - d0) / (d1 - d0) : 0;
                const out = new Vec3();
                Vec3.lerp(out, this.headHistory[prev], this.headHistory[idx], t);
                return out;
            }
            idx = prev;
        }
        return this.headHistory[oldest].clone();
    }

    private faceDirection(node: Node, dir: Vec3, extraYDeg: number = 0) {
        if (!node) return;
        const flat = new Vec3(dir.x, 0, dir.z);
        if (flat.lengthSqr() < 0.0001) return;
        Vec3.normalize(flat, flat);
        const angle = Math.atan2(flat.x, flat.z) + Math.PI / 2 + math.toRadian(extraYDeg);
        const q = new Quat();
        Quat.fromEuler(q, 0, math.toDegree(angle), 0);
        node.setWorldRotation(q);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    startMoving() {
        if (!this.snakePath || !this.headNode) return;
        enqueueSnake(this);
    }

    beginMoving() {
        this._bounceRetryCount = 0;
        if (!this.snakePath || !this.headNode) return;
        this._moveStartTime      = Date.now();
        this.currentPathDistance = this.snakePath.getClosestDistance(this.headNode.getWorldPosition());
        this.targetPathPoint     = this.snakePath.getPointAtDistance(this.currentPathDistance);

        const startPos = this.headNode.getWorldPosition();
        const initialDir = new Vec3();
        Vec3.subtract(initialDir, this.targetPathPoint, startPos);
        initialDir.y = 0;
        if (initialDir.lengthSqr() > 0.000001) {
            Vec3.normalize(this.lastTravelDir, initialDir);
        }

        const distToPath = Vec3.distance(this.headNode.getWorldPosition(), this.targetPathPoint);
        if (distToPath < 0.5) {
            this.isOnPath            = true;
            this._isJoining          = false;
            this._hasFinishedJoining = true;
            notifyJoinComplete(this);
        } else {
            this.isOnPath            = false;
            this._isJoining          = true;
            this._hasFinishedJoining = false;
        }

        this.segmentLags = this.bodySegments.map((_, i) => this.segmentSpacing * (i + 1));
        this.seedHistoryFromCurrentPose();
        this.isMoving = true;
    }

    stopMoving() {
        this.isMoving = false;
        this.isOnPath = false;
    }

    setSnakeColor(color: string) {
        this.snakeColor = color;
        const c = this.getSnakeColor();
        this.applyColor(this.headNode, c);
        for (const seg of this.bodySegments) this.applyColor(seg, c);
    }

    isEnteringHole(): boolean  { return this._isEntering; }
    isEntryFinished(): boolean { return this._entryFinished; }
    isMovingNow(): boolean     { return this.isMoving; }
    hasFailed(): boolean       { return this._hasFailed; }
    canMoveNow(): boolean      { return !this.isLocked() && !this.isFrontBlocked() && this.canFitOnPath(); }
    getHeadNode(): Node | null { return this.headNode; }

    isOnPathHalfway(): boolean {
        if (!this.isOnPath || !this.snakePath) return false;
        const pathLen = this.snakePath.getPathLength();
        return pathLen > 0 && this.currentPathDistance >= pathLen / 2;
    }

    private getBodyLength(): number {
        return this.segmentSpacing * (this.bodySegments.length + 1);
    }

    private splitWrappedRange(start: number, end: number, pathLength: number): { start: number; end: number }[] {
        const ranges: { start: number; end: number }[] = [];
        const span = end - start;
        if (span >= pathLength) {
            ranges.push({ start: 0, end: pathLength });
            return ranges;
        }

        while (start < 0) {
            start += pathLength;
            end += pathLength;
        }
        while (start >= pathLength) {
            start -= pathLength;
            end -= pathLength;
        }

        if (end <= pathLength) {
            ranges.push({ start, end });
        } else {
            ranges.push({ start, end: pathLength });
            ranges.push({ start: 0, end: end - pathLength });
        }

        return ranges;
    }

    private getMergedOccupiedRanges(pathLength: number): { start: number; end: number }[] {
        const occupiedRanges: { start: number; end: number }[] = [];

        for (const other of this.getAllSnakes()) {
            if (other === this) continue;
            if (other._isEntering || other._entryFinished || other._hasFailed) continue;
            if (other._moveStartTime === Infinity) continue;
            if (!other.isOnPath) continue;
            if (other._isJoining) continue;

            const headDist = other.currentPathDistance;
            const tailDist = headDist - other.getBodyLength();
            const ranges = this.splitWrappedRange(
                tailDist - this.minSeparation,
                headDist + this.minSeparation,
                pathLength
            );
            for (const r of ranges) occupiedRanges.push(r);
        }

        if (occupiedRanges.length === 0) return [];

        occupiedRanges.sort((a, b) => a.start - b.start);

        const merged: { start: number; end: number }[] = [];
        for (const range of occupiedRanges) {
            if (merged.length === 0) {
                merged.push({ start: range.start, end: range.end });
                continue;
            }
            const last = merged[merged.length - 1];
            if (range.start <= last.end) {
                if (range.end > last.end) last.end = range.end;
            } else {
                merged.push({ start: range.start, end: range.end });
            }
        }

        return merged;
    }

    private canFullyEnterFromCurrentEntry(pathLength: number, mergedOccupied: { start: number; end: number }[]): boolean {
        if (mergedOccupied.length === 0) return true;

        const entryWorldPos = this.targetPathPoint && this.targetPathPoint.lengthSqr() > 0
            ? this.targetPathPoint
            : (this.headNode ? this.headNode.getWorldPosition() : this.node.getWorldPosition());
        const entryDist = this.snakePath!.getClosestDistance(entryWorldPos);

        const requiredStart = entryDist - this.getBodyLength() - this.minSeparation;
        const requiredEnd   = entryDist + this.minSeparation;
        const requiredRanges = this.splitWrappedRange(requiredStart, requiredEnd, pathLength);

        for (const req of requiredRanges) {
            for (const occ of mergedOccupied) {
                const overlap = req.start < occ.end && req.end > occ.start;
                if (overlap) return false;
            }
        }

        return true;
    }

    canFitOnPath(): boolean {
        if (!this.snakePath) return true;

        const myLength = this.getBodyLength();
        const pathLength = this.snakePath.getPathLength();
        if (pathLength <= 0) return true;

        const merged = this.getMergedOccupiedRanges(pathLength);
        if (merged.length === 0) return true;

        if (this._isJoining || !this.isOnPath) {
            return this.canFullyEnterFromCurrentEntry(pathLength, merged);
        }

        let maxFreeGap = 0;
        for (let i = 1; i < merged.length; i++) {
            const gap = merged[i].start - merged[i - 1].end;
            if (gap > maxFreeGap) maxFreeGap = gap;
        }

        const wrapGap = (merged[0].start + pathLength) - merged[merged.length - 1].end;
        if (wrapGap > maxFreeGap) maxFreeGap = wrapGap;

        return maxFreeGap >= myLength;
    }

    private triggerFailed(): void {
        this.triggerFailedWithPopup();
    }

    private triggerFailedInstant(): void {
         console.log('[Snake] triggerFailedInstant called. _hasFailed already:', this._hasFailed);
        if (this._hasFailed) return;
        
        this._hasFailed    = true;
        this.isMoving      = false;
        this._isBounceBack = false;
        this.unfreezeInPlace();
        console.warn(`[Snake] "${this.node.name}" failed instantly – track full.`);

        this.node.emit('snake-failed', { snake: this });
        this.node.scene?.emit('force-fail-now', { snake: this });

        let n: Node = this.node;
        while (n.parent) {
            n = n.parent;
            n.emit('show-failed-screen', { snake: this });
        }

        if (_currentlyJoining === this) {
            _currentlyJoining = null;
            tryLaunchNext();
        }
    }

    enterHole(holeWorldPos: Vec3, onComplete?: () => void) {
        if (this._isEntering) return;
        this._isEntering        = true;
        this._holePos.set(holeWorldPos);
        this._entryStartPos.set(this.headNode.getWorldPosition());
        this._entryDistTraveled = 0;
        if (onComplete) this._onEntryComplete = onComplete;
    }
}