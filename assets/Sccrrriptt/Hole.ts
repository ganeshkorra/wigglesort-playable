import { _decorator, Component, Node, MeshRenderer, Material, director, Prefab, instantiate, Vec3, ParticleSystem } from 'cc';
import { GameManager } from './GameManager';
const { ccclass, property } = _decorator;

@ccclass('ColorMaterialMapping')
class ColorMaterialMapping {
    @property
    colorName: string = "";
    @property(Material)
    material: Material = null!;
}

@ccclass('Hole')
export class Hole extends Component {

    @property(MeshRenderer) holeRimRenderer: MeshRenderer = null!;
    @property(MeshRenderer) nextIndicatorRenderer: MeshRenderer = null!;
    @property([ColorMaterialMapping]) colorMappings: ColorMaterialMapping[] = [];

    // --- ANIMATION PREFAB ---
    @property(Prefab) vortexEffectPrefab: Prefab = null!;
    private activeEffect: Node | null = null;
    private snakesInsideCount: number = 0; 

    private currentIndex: number = 0;
    private sortedCount: number = 0;
    private totalSnakes: number = 0;

    // Progression flags for Analytics
    private pass25: boolean = false;
    private pass50: boolean = false;
    private pass75: boolean = false;

    onLoad() {
        if (this.colorMappings.length > 0) {
            this.updateHoleVisuals();
        }
    }

    start() {
        this.totalSnakes = director.getScene()!.getComponentsInChildren('WormController').length;
    }

    /**
     * Spawns the particle and forces it to play
     */
    public playHoleAnimation() {
        this.snakesInsideCount++;
        
        if (!this.activeEffect && this.vortexEffectPrefab) {
            this.activeEffect = instantiate(this.vortexEffectPrefab);
            
            // Put it inside the Hole node
            this.node.addChild(this.activeEffect);
            
            // POSITION FIX: Place it slightly above the hole surface (Y + 0.2)
            const holeWorldPos = this.node.worldPosition.clone();
            this.activeEffect.setWorldPosition(new Vec3(holeWorldPos.x, holeWorldPos.y + 0.2, holeWorldPos.z));
            
            // --- CRITICAL FIX: FORCE PARTICLE TO PLAY ---
            let pSystem = this.activeEffect.getComponent(ParticleSystem);
            if (!pSystem) pSystem = this.activeEffect.getComponentInChildren(ParticleSystem);
            
            if (pSystem) {
                pSystem.stop();
                pSystem.play();
                console.log("Particle System forced to Play");
            } else {
                console.error("No Particle System found in your Prefab!");
            }
        }
    }

    /**
     * Cleans up the effect
     */
    public stopHoleAnimation() {
        this.snakesInsideCount--;
        
        if (this.snakesInsideCount <= 0 && this.activeEffect) {
            this.activeEffect.destroy();
            this.activeEffect = null;
            this.snakesInsideCount = 0;
        }
    }

    public canAccept(snakeColor: string): boolean {
        if (this.colorMappings.length === 0) return false;
        const required = this.colorMappings[this.currentIndex].colorName;
        return required.toLowerCase() === snakeColor.toLowerCase();
    }

   public getNeededColor(): string {
    // Looks at the current material name required in your Color Mapping list
    return this.colorMappings[this.currentIndex].colorName;
}
    public onSnakeSorted() {
        if (GameManager.instance) GameManager.instance.playSFX('destroy');
        this.sortedCount++;
        this.checkProgressionAnalytics();
        this.currentIndex = (this.currentIndex + 1) % this.colorMappings.length;
        this.updateHoleVisuals();

        if (this.sortedCount >= this.totalSnakes && GameManager.instance) {
            GameManager.instance.trackALEvent('CHALLENGE_SOLVED');
            GameManager.instance.gameOver();
        }
    }

    private checkProgressionAnalytics() {
        if (!GameManager.instance || this.totalSnakes === 0) return;
        const progress = this.sortedCount / this.totalSnakes;
        if (progress >= 0.75 && !this.pass75) { this.pass75 = true; GameManager.instance.trackALEvent('CHALLENGE_PASS_75'); } 
        else if (progress >= 0.50 && !this.pass50) { this.pass50 = true; GameManager.instance.trackALEvent('CHALLENGE_PASS_50'); } 
        else if (progress >= 0.25 && !this.pass25) { this.pass25 = true; GameManager.instance.trackALEvent('CHALLENGE_PASS_25'); }
    }

    private updateHoleVisuals() {
        const currentMapping = this.colorMappings[this.currentIndex];
        if (currentMapping && this.holeRimRenderer) {
            this.holeRimRenderer.setMaterial(currentMapping.material, 0);
        }
        const nextIndex = (this.currentIndex + 1) % this.colorMappings.length;
        const nextMapping = this.colorMappings[nextIndex];
        if (nextMapping && this.nextIndicatorRenderer) {
            this.nextIndicatorRenderer.setMaterial(nextMapping.material, 0);
        }
    }
}