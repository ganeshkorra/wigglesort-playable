import { _decorator, Component, Node, input, Input, EventMouse, EventTouch, AudioSource, AudioClip } from 'cc';
import { SnakeGenerator } from './SnakeGenerator';
import { Snake } from './Snake';
import { Hole } from './Hole';
import { FailedScreen } from './failedscreen';
import { CTAScreen } from './CTAScreen';
import { TutorialHand } from './TutorialHand';
import { ALAnalytics } from './metrics';
const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {

    

    @property({ type: FailedScreen, tooltip: 'FailedScreen component reference' })
    failedScreen: FailedScreen = null;

    @property({ type: CTAScreen, tooltip: 'CTAScreen component reference' })
    ctaScreen: CTAScreen = null;

    @property({ type: TutorialHand, tooltip: 'TutorialHand component reference' })
    tutorialHand: TutorialHand = null;

    @property({ tooltip: 'Seconds after first click before showing CTA' })
    gameTimerDuration: number = 40;

    @property({ tooltip: 'Seconds of player idle before re-showing tutorial hand' })
    tutorialIdleDuration: number = 6;

    @property({ type: AudioSource, tooltip: 'Single AudioSource used to play gameplay SFX.' })
    sfxAudioSource: AudioSource = null;

    @property({ type: AudioClip, tooltip: 'Sound played when a snake is tapped.' })
    tapSfx: AudioClip = null;

    @property({ type: AudioClip, tooltip: 'Sound played when a wrong snake is clicked.' })
    wrongTapSfx: AudioClip = null;

    @property({ type: AudioClip, tooltip: 'Sound played when a snake starts entering a hole.' })
    snakeEnterHoleSfx: AudioClip = null;

    private _sceneRoot: Node = null;
    private _pollInterval: any = null;
    private _timerActive: boolean = false; 
    private _timeRemaining: number = 0; 
    private _gameOver: boolean = false; 
    private _gameStarted: boolean = false; 
    private _initialSnakeCount: number = 0; 
    private _idleTimer: number = 0;  
    private _challengeStartedTracked: boolean = false;
    private _pass25Tracked: boolean = false;
    private _pass50Tracked: boolean = false;
    private _pass75Tracked: boolean = false;
    private _endcardTracked: boolean = false;
    private _deadlockTimer: number = 0;

    onLoad() {
        ALAnalytics.loading();
    }
 
    start() {
    this._timeRemaining = this.gameTimerDuration;

    input.on(Input.EventType.MOUSE_DOWN, this.onFirstInput, this);
    input.on(Input.EventType.TOUCH_START, this.onFirstInput, this);
    input.on(Input.EventType.MOUSE_DOWN, this.onAnyInput, this);
    input.on(Input.EventType.TOUCH_START, this.onAnyInput, this);
    this.node.scene.on('snake-failed', this.onSnakeFailed, this);
    this.node.scene.on('show-failed-screen', this.onSnakeFailed, this);
    this.node.scene.on('force-fail-now', this.onSnakeFailed, this);

    this.scheduleOnce(() => {
        const snakes = this.node.scene.getComponentsInChildren(Snake);
        this._initialSnakeCount = snakes.length;
        this._gameStarted = this._initialSnakeCount > 0;
        ALAnalytics.loaded();
        ALAnalytics.displayed();
        if (this._gameStarted && !this._challengeStartedTracked) {
            ALAnalytics.challengeStarted();
            this._challengeStartedTracked = true;
        }
        this._showTutorialTarget();
    }, 0);
    }

    onDestroy() {
        if (this._pollInterval) clearInterval(this._pollInterval);
        input.off(Input.EventType.MOUSE_DOWN, this.onFirstInput, this);
        input.off(Input.EventType.TOUCH_START, this.onFirstInput, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onAnyInput, this);
        input.off(Input.EventType.TOUCH_START, this.onAnyInput, this);
        this.node.scene.off('snake-failed', this.onSnakeFailed, this);
        this.node.scene.off('show-failed-screen', this.onSnakeFailed, this);
        this.node.scene.off('force-fail-now', this.onSnakeFailed, this);
    }

    private onSnakeTapSfx() {
        this._playSfx(this.tapSfx);
    }

    private onSnakeWrongTapSfx() {
        this._playSfx(this.wrongTapSfx);
    }

    private onSnakeEnterHoleSfx() {
        this._playSfx(this.snakeEnterHoleSfx);
    }

    private _playSfx(clip: AudioClip | null) {
        if (!clip) return;
        const source = this.sfxAudioSource ?? this.getComponent(AudioSource);
        source?.playOneShot(clip, 1.0);
    }

    private onFirstInput() {
        if (this._timerActive || this._gameOver) return;
        this._timerActive = true;
        if (this._gameStarted && !this._challengeStartedTracked) {
            ALAnalytics.challengeStarted();
            this._challengeStartedTracked = true;
        }
        // Stop listening after first input
        input.off(Input.EventType.MOUSE_DOWN, this.onFirstInput, this);
        input.off(Input.EventType.TOUCH_START, this.onFirstInput, this);
        this._evaluateEndConditions();
        console.log(`[GameManager] First input detected. Timer started: ${this.gameTimerDuration}s`);
    }

    private onAnyInput() {
        this._idleTimer = 0;
        if (this.tutorialHand) this.tutorialHand.hide();
    }

    private _isSnakeMatchingAnyCurrentHoleColor(snake: Snake, holes: Hole[]): boolean {
        const snakeCol = snake.snakeColor.toLowerCase().trim();
        for (const hole of holes) {
            const targetColor = hole.getCurrentColorName();
            if (!targetColor) continue;
            const isMatch = snakeCol === targetColor
                || targetColor.includes(snakeCol)
                || snakeCol.includes(targetColor);
            if (isMatch) return true;
        }
        return false;
    }

    private _showTutorialTarget() {
        if (!this.tutorialHand || this._gameOver) return;

        const snakes = this.node.scene.getComponentsInChildren(Snake);
        const moveableSnakes = snakes.filter(s =>
            !s.hasFailed() && !s.isMovingNow() &&
            !s.isEnteringHole() && !s.isEntryFinished() &&
            s.canMoveNow()
        );

        if (moveableSnakes.length === 0) return;

        const holes = this.node.scene.getComponentsInChildren(Hole);
        const matchingMoveable = moveableSnakes.find(s => this._isSnakeMatchingAnyCurrentHoleColor(s, holes));

        this.tutorialHand.attachTo(matchingMoveable ?? moveableSnakes[0]);
    }

    private onSnakeFailed() {
        this._triggerFail();
    }

    private _findFailedScreen(node: Node | null): FailedScreen | null {
        if (!node) return null;
        const direct = node.getComponent(FailedScreen);
        if (direct) return direct;
        for (const child of node.children) {
            const found = this._findFailedScreen(child);
            if (found) return found;
        }
        return null;
    }

    private _findCtaScreen(node: Node | null): CTAScreen | null {
        if (!node) return null;
        const direct = node.getComponent(CTAScreen);
        if (direct) return direct;
        for (const child of node.children) {
            const found = this._findCtaScreen(child);
            if (found) return found;
        }
        return null;
    }

    private _resolveUiRefs() {
        if (!this.failedScreen) {
            const foundFailed = this._findFailedScreen(this.node.scene);
            if (foundFailed) this.failedScreen = foundFailed;
        }

        if (!this.ctaScreen) {
            const foundCta = this._findCtaScreen(this.node.scene);
            if (foundCta) this.ctaScreen = foundCta;
        }
    }

    private _forceActivateNodeChain(target: Node | null) {
        let node = target;
        while (node) {
            if (!node.active) node.active = true;
            node = node.parent;
        }
    }

    private _evaluateEndConditions() {
        if (!this._gameStarted || this._gameOver) return;

        const snakes = this.node.scene.getComponentsInChildren(Snake);
        if (snakes.some(s => s.hasFailed())) {
            this._triggerFail();
            return;
        }

        if (!this._timerActive) return;

        const activeSnakes = snakes.filter(s => !s.hasFailed() && !s.isEnteringHole() && !s.isEntryFinished());
        this._trackProgressMilestones(activeSnakes.length);

        if (activeSnakes.length === 0) {
            this._triggerWin();
        }
    }

    private _triggerFail() {
    if (this._gameOver) return;
    this._gameOver = true;
    this._timerActive = false;
    if (this._pollInterval) clearInterval(this._pollInterval);
    ALAnalytics.challengeFailed();
    if (this.tutorialHand) this.tutorialHand.hide();
    this._resolveUiRefs();

    console.log('[GameManager] _triggerFail — failedScreen:', !!this.failedScreen);

    if (this.failedScreen) {
        // Force show failed screen
        this._forceActivateNodeChain(this.failedScreen.failedCanvas ?? this.failedScreen.node);
        this.failedScreen.showFailed();

        // After 1 second hide it and show CTA
        setTimeout(() => {
            this.failedScreen.hideFailed();
            this.showCTA();
        }, 1000);
    } else {
        console.error('[GameManager] FailedScreen not found. Showing CTA directly.');
        this.showCTA();
    }
}

    private _triggerNoSpaceFail() {
        this._triggerFail();
    }

    private _triggerWin() {
    if (this._gameOver) return;
    this._gameOver = true;
    this._timerActive = false;
    if (this._pollInterval) clearInterval(this._pollInterval);
    ALAnalytics.challengeSolved();
    if (this.tutorialHand) this.tutorialHand.hide();
    this.showCTA();
}

    private showCTA() {
    this._resolveUiRefs();
    console.log('[GameManager] showCTA called. ctaScreen:', !!this.ctaScreen);
    if (this.ctaScreen) {
        this._forceActivateNodeChain(this.ctaScreen.ctaCanvas ?? this.ctaScreen.node);
        this.ctaScreen.show();
    }
    if (!this._endcardTracked) {
        ALAnalytics.endcardShown();
        this._endcardTracked = true;
    }
}

    private _trackProgressMilestones(activeSnakeCount: number) {
        if (this._initialSnakeCount <= 0) return;
        const solvedRatio = (this._initialSnakeCount - activeSnakeCount) / this._initialSnakeCount;

        if (!this._pass25Tracked && solvedRatio >= 0.25) {
            ALAnalytics.challengePass25();
            this._pass25Tracked = true;
        }
        if (!this._pass50Tracked && solvedRatio >= 0.5) {
            ALAnalytics.challengePass50();
            this._pass50Tracked = true;
        }
        if (!this._pass75Tracked && solvedRatio >= 0.75) {
            ALAnalytics.challengePass75();
            this._pass75Tracked = true;
        }
    }

    private _hasAnySnakeMatchingCurrentHoleColor(snakes: Snake[]): boolean {
        const holes = this.node.scene.getComponentsInChildren(Hole);
        if (holes.length === 0) return true;

        for (const snake of snakes) {
            const snakeCol = snake.snakeColor.toLowerCase().trim();
            for (const hole of holes) {
                const targetColor = hole.getCurrentColorName();
                if (!targetColor) continue;
                const isMatch = snakeCol === targetColor
                    || targetColor.includes(snakeCol)
                    || snakeCol.includes(targetColor);
                if (isMatch) return true;
            }
        }

        return false;
    }

    private _isNoSpaceDeadlock(activeSnakes: Snake[]): boolean {
        if (activeSnakes.length === 0) return false;
        return activeSnakes.every(s => !s.canFitOnPath());
    }

    private _isImmediateDeadlock(activeSnakes: Snake[]): boolean {
        if (activeSnakes.length === 0) return false;

        const noSnakeCanFitOnPath = activeSnakes.every(s => !s.canFitOnPath());
        if (noSnakeCanFitOnPath) return true;

        const hasMovingSnake = activeSnakes.some(s => s.isMovingNow());
        if (hasMovingSnake) return false;

        const hasAnyMatch = this._hasAnySnakeMatchingCurrentHoleColor(activeSnakes);
        if (hasAnyMatch) return false;

        const hasActionableSnake = activeSnakes.some(s => s.canMoveNow());
        if (hasActionableSnake) return false;

        return true;
    }

    update(deltaTime: number) {
        if (this._gameOver) return;

        // ── Tutorial idle timer ───────────────────────────────────────────────
        if (this.tutorialHand && !this.tutorialHand.isVisible()) {
            this._idleTimer += deltaTime;
            if (this._idleTimer >= this.tutorialIdleDuration) {
                this._idleTimer = 0;
                this._showTutorialTarget();
            }
        }

        // ── Countdown timer ──────────────────────────────────────────────────
        if (this._timerActive) {
            this._timeRemaining -= deltaTime;
            if (this._timeRemaining <= 0) {
                this._timeRemaining = 0;
                this._timerActive = false;
            }
        }

        // ── Deadlock detection: any snake past halfway + all stopped ─────────
        if (this._timerActive && !this._gameOver) {
            const snakes = this.node.scene.getComponentsInChildren(Snake);
            const activeSnakes = snakes.filter(
                s => !s.hasFailed() && !s.isEnteringHole() && !s.isEntryFinished()
            );
            if (activeSnakes.length > 0) {
                const anyHalfway = activeSnakes.some(s => s.isOnPathHalfway());
                const allStopped = activeSnakes.every(s => !s.isMovingNow());
                if (anyHalfway && allStopped) {
                    this._deadlockTimer += deltaTime;
                    if (this._deadlockTimer >= 2.0) {
                        console.warn('[GameManager] Deadlock detected – snake past halfway, all stopped.');
                        this._triggerFail();
                        return;
                    }
                } else {
                    this._deadlockTimer = 0;
                }
            }
        }

        // ── Fail + win detection starts strictly after first interaction ─────
        this._evaluateEndConditions();
    }
}


