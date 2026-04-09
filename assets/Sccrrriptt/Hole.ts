import { _decorator, Component, Node, MeshRenderer, Material } from 'cc';
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

    @property(MeshRenderer)
    holeRimRenderer: MeshRenderer = null!;

    @property(MeshRenderer)
    nextIndicatorRenderer: MeshRenderer = null!;

    @property([ColorMaterialMapping])
    colorMappings: ColorMaterialMapping[] = [];

    // Tracks which color is currently required
    private currentIndex: number = 0;

public getNeededColor(): string {
    return this.colorMappings[this.currentIndex].colorName;
}
    onLoad() {
        if (this.colorMappings.length > 0) {
            this.updateHoleVisuals();
        }
    }

    // This checks the CURRENT required color in the list
    public canAccept(snakeColor: string): boolean {
        if (this.colorMappings.length === 0) return false;
        return this.colorMappings[this.currentIndex].colorName === snakeColor;
    }

    // Logic to move to the next color in the list
    public onSnakeSorted() {
        // Move to next color index, looping back to start if finished
        this.currentIndex = (this.currentIndex + 1) % this.colorMappings.length;
        this.updateHoleVisuals();
    }

    private updateHoleVisuals() {
        // 1. Update the Main Rim with the Current color
        const currentMapping = this.colorMappings[this.currentIndex];
        if (currentMapping && this.holeRimRenderer) {
            this.holeRimRenderer.setMaterial(currentMapping.material, 0);
        }

        // 2. Update the Indicator with the Next color (Index + 1)
        const nextIndex = (this.currentIndex + 1) % this.colorMappings.length;
        const nextMapping = this.colorMappings[nextIndex];
        if (nextMapping && this.nextIndicatorRenderer) {
            this.nextIndicatorRenderer.setMaterial(nextMapping.material, 0);
        }
    }
}