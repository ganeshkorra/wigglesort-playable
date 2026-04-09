import { _decorator, Component, Node, Label, director, Vec3, AudioSource, AudioClip } from 'cc';
import { Hole } from './Hole';
import { WormController } from './WormController';
import { ALAnalytics } from './ALAnalytics'; 
const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {
    public static instance: GameManager = null!;

    @property(Label) timerLabel: Label = null!; 
    @property(Node) ctaScreen: Node = null!; 
    @property(Node) handNode: Node = null!; 
    @property(Hole) holeNode: Hole = null!;

    // --- SOUND PROPERTIES ---
    @property(AudioSource) audioSource: AudioSource = null!; // SFX Player
    @property(AudioClip) tapSound: AudioClip = null!;
    @property(AudioClip) wrongSound: AudioClip = null!;
    @property(AudioClip) destroySound: AudioClip = null!;
    @property(AudioClip) bgmMusic: AudioClip = null!;

    @property gameDuration: number = 45;
    @property idleLimit: number = 7;

    public isTimerRunning: boolean = false;
    private isGameOver: boolean = false;
    private timeLeft: number = 0;
    private idleTimer: number = 0;

    onLoad() { 
        GameManager.instance = this; 
        this.timeLeft = this.gameDuration;
    }

    start() {
        if (this.handNode) this.handNode.active = true; 
        this.updateTimerLabel();

        // [EVENT] DISPLAYED: Ad renders and game becomes interactive
        this.trackALEvent('DISPLAYED');
    }

    public beginTimer() {
        if (this.isGameOver) return;
        if (!this.isTimerRunning) {
            this.isTimerRunning = true;

            // [EVENT] CHALLENGE_STARTED: User touches the screen and timer begins
            this.trackALEvent('CHALLENGE_STARTED');

            // 4. PLAY BGM when countdown starts
            this.playBGM();
        }
        this.onUserInteraction();
    }

    public onUserInteraction() {
        this.idleTimer = 0;
        if (this.handNode) this.handNode.active = false;
    }

    // --- CENTRAL SOUND FUNCTIONS ---
    private playBGM() {
        if (this.bgmMusic && this.audioSource) {
            this.audioSource.clip = this.bgmMusic; // 1. Assign the clip to the source
            this.audioSource.loop = true;          // 2. Enable looping
            this.audioSource.volume = 0.5;         // 3. Set music volume
            this.audioSource.play();               // 4. Start the looping playback
            
            console.log("BGM started in loop mode.");
        }
    }

  public playSFX(type: string) {
        let clip: AudioClip | null = null;
        if (type === 'tap') clip = this.tapSound;
        if (type === 'wrong') clip = this.wrongSound;
        if (type === 'destroy') clip = this.destroySound;

        if (this.audioSource && clip) {
            // playOneShot allows sounds to "stack" over the looping BGM
            this.audioSource.playOneShot(clip, 1.0);
        }
    }

    public getIsGameOver(): boolean { return this.isGameOver; }

    update(dt: number) {
        if (this.isGameOver) return;
        if (this.isTimerRunning) {
            this.timeLeft -= dt;
            if (this.timeLeft <= 0) { 
                
                // [EVENT] CHALLENGE_FAILED: The timer ended before clear.
                this.trackALEvent('CHALLENGE_FAILED');

                this.gameOver(); 
                return; 
            }
            this.updateTimerLabel();
            this.idleTimer += dt;
            if (this.idleTimer >= this.idleLimit) { this.showHint(); }
        }
    }

    private showHint() {
        if (!this.holeNode || !this.handNode) return;
        const color = this.holeNode.getNeededColor();
        const snakes = director.getScene()!.getComponentsInChildren(WormController);
        for (let worm of snakes) {
            if (worm.node.active && worm.isIdle() && worm.snakeColor === color && worm.canSlitherOut()) {
                let head = worm.node.children[0];
                this.handNode.setWorldPosition(head.worldPosition.clone().add(new Vec3(0, 1.5, 0)));
                this.handNode.active = true;
                return;
            }
        }
    }

    public gameOver() {
        this.isGameOver = true;
        this.isTimerRunning = false;

        // Stop the looping BGM when the CTA appears
        if (this.audioSource) {
            this.audioSource.stop();
        }

        if (this.handNode) this.handNode.active = false;
        if (this.ctaScreen) {
            this.ctaScreen.active = true;
            ALAnalytics.endcardShown();
        }
    }
    
    // Inside GameManager class, add this function:
    public onCircularTrackFull() {
        if (this.isGameOver) return;
        console.warn("Circular path is jammed! No more space. Ending game.");
        
        // Custom decision based on requirements, treat jammed as challenge failure too
        this.trackALEvent('CHALLENGE_FAILED');

        this.gameOver(); // Trigger Endscreen/CTA
    }

    private updateTimerLabel() {
        if (this.timerLabel) this.timerLabel.string = Math.ceil(this.timeLeft).toString();
    }

    // AppLovin Analytics Global Dispatch Helper
    public trackALEvent(eventName: string) {
        console.log("AppLovin event logged: " + eventName);
        if (typeof (window as any).ALPlayableAnalytics !== 'undefined') {
            (window as any).ALPlayableAnalytics.trackEvent(eventName);
        }
    }
}