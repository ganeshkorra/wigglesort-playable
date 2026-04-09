import { _decorator, Component, Node, Vec3, director, Vec2 } from 'cc';
import { Hole } from './Hole';
import { WormController } from './WormController';
import { GameManager } from './GameManager';
const { ccclass, property } = _decorator;

@ccclass('TutorialHand')
export class TutorialHand extends Component {

    public static instance: TutorialHand = null!;

    @property(Node) handIdle: Node = null!;
    @property(Node) handClicked: Node = null!;
    @property(Hole) holeNode: Hole = null!;

    @property toggleInterval: number = 0.5;
    @property offsetY: number = 1.2;
    // @property idleLimit: number = 7.0; 

    private currentTargetSnake: Node | null = null;
    private isTapped: boolean = false;
    private idleTimer: number = 0;
    private showingInitialTutorial: boolean = true;

    onLoad() {
        TutorialHand.instance = this;
    }

    start() {
        this.schedule(() => {
            this.isTapped = !this.isTapped;
            if(this.handIdle) this.handIdle.active = !this.isTapped;
            if(this.handClicked) this.handClicked.active = this.isTapped;
        }, this.toggleInterval);
    }

    // Call this from WormController when the user interacts
    public resetIdleTimer() {
        this.idleTimer = 0;
        this.showingInitialTutorial = false;
        // Turn off hand until 7 seconds of silence
        this.node.active = false; 
    }

    update(dt: number) {
        if (!GameManager.instance) return;

        // Force stop if game ends
        if (GameManager.instance.getIsGameOver()) {
            this.node.active = false;
            return;
        }

        const isGameCounting = GameManager.instance.isTimerRunning;

        if (this.showingInitialTutorial) {
            // STEP 1: INITIAL LOAD VIEW
            this.node.active = true;
            this.runFollowLogic();
        } else if (isGameCounting) {
            // STEP 2: IDLE MONITORING
            // this.idleTimer += dt;
            
            // Console check to debug in vConsole
            // if (this.idleTimer >= this.idleLimit) {
            //     this.node.active = true;
            //     this.runFollowLogic();
            // } 
             {
                this.node.active = true;
            }
        }
    }

    private runFollowLogic() {
        this.findCorrectSnake();
        if (this.currentTargetSnake) {
            const targetPos = this.currentTargetSnake.worldPosition.clone();
            targetPos.y += this.offsetY;
            
            let currentPos = this.node.worldPosition.clone();
            // Smoothly lerp the hand to the target
            Vec3.lerp(currentPos, currentPos, targetPos, 0.2);
            this.node.setWorldPosition(currentPos);
        } else {
            // No valid snakes left? Turn off hand.
            this.node.active = false;
        }
    }

    private findCorrectSnake() {
        if (!this.holeNode) return;
        const targetColor = this.holeNode.getNeededColor();
        const snakes = director.getScene()!.getComponentsInChildren(WormController);
        
        this.currentTargetSnake = null;

        // Priority 1: Match color and unblocked
        for (let worm of snakes) {
            if (worm.node.active && worm.snakeColor === targetColor && worm.canSlitherOut()) {
                this.currentTargetSnake = worm.node.children[0];
                return; 
            }
        }

        // Priority 2: Match color (even if blocked) - help player move blocker first
        for (let worm of snakes) {
            if (worm.node.active && worm.snakeColor === targetColor) {
                this.currentTargetSnake = worm.node.children[0];
                return;
            }
        }

        // Priority 3: Any unblocked snake
        for (let worm of snakes) {
            if (worm.node.active && worm.canSlitherOut()) {
                this.currentTargetSnake = worm.node.children[0];
                return;
            }
        }
    }
}