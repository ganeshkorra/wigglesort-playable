import { _decorator, Component, Node, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('RotateClockwise')
export class RotateClockwise extends Component {

    @property
    speed: number = 50; // degrees per second

    private _euler: Vec3 = new Vec3();

    update(deltaTime: number) {
        // Get current rotation
        this.node.getRotation().getEulerAngles(this._euler);

        // Rotate clockwise on Z axis (negative for clockwise)
        this._euler.y += this.speed * deltaTime;

        // Apply rotation
        this.node.setRotationFromEuler(this._euler);
    }
}