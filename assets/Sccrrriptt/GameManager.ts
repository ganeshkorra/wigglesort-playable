import { _decorator, Component, Node, Label, director, Vec3 } from 'cc';
import { Hole } from './Hole';
import { WormController } from './WormController';
const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {
    public static instance: GameManager = null!;

    @property(Label) timerLabel: Label = null!; 
    @property(Node) ctaScreen: Node = null!; 
    @property(Node) handNode: Node = null!; 
    @property(Hole) holeNode: Hole = null!;

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
    }

    // FIX FOR ERROR: Property 'beginTimer' does not exist
    public beginTimer() {
        if (this.isGameOver) return;
        if (!this.isTimerRunning) {
            this.isTimerRunning = true;
            console.log("Game Timer Started!");
        }
        this.onUserInteraction();
    }

    // Resets the idle state when player taps
    public onUserInteraction() {
        this.idleTimer = 0;
        if (this.handNode) this.handNode.active = false;
    }

    // FIX FOR ERROR: Property 'getIsGameOver' does not exist
    public getIsGameOver(): boolean {
        return this.isGameOver;
    }

    update(dt: number) {
        if (this.isGameOver) return;

        if (this.isTimerRunning) {
            // 1. Countdown Logic
            this.timeLeft -= dt;
            if (this.timeLeft <= 0) { 
                this.gameOver(); 
                return; 
            }
            this.updateTimerLabel();

            // 2. Idle Tracking Logic
            this.idleTimer += dt;
            if (this.idleTimer >= this.idleLimit) {
                this.showHint();
            }
        }
    }

private showHint() {
        if (!this.holeNode || !this.handNode) return;
        const color = this.holeNode.getNeededColor();
        const snakes = director.getScene()!.getComponentsInChildren(WormController);
        
        for (let worm of snakes) {
            // NEW CONDITION: Add worm.isIdle()
            // This prevents the hand from appearing on the circular path
            if (worm.node.active && worm.isIdle() && worm.snakeColor === color && worm.canSlitherOut()) {
                let head = worm.node.children[0];
                let targetPos = head.worldPosition.clone();
                targetPos.y += 1.5; 
                
                this.handNode.setWorldPosition(targetPos);
                this.handNode.active = true;
                return; // Stop looking after finding the first exitable idle snake
            }
        }
    }

    private gameOver() {
        this.isGameOver = true;
        this.isTimerRunning = false;
        if (this.handNode) this.handNode.active = false;
        if (this.ctaScreen) this.ctaScreen.active = true;
    }

    private updateTimerLabel() {
        if (this.timerLabel) {
            this.timerLabel.string = Math.ceil(this.timeLeft).toString();
        }
    }
}