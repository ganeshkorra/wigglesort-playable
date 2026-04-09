import { _decorator, Component, Node, tween, Vec3 } from 'cc';
const { ccclass } = _decorator;

@ccclass('ScaleInOut')
export class ScaleInOut extends Component {

    private baseScale: Vec3 = new Vec3();

    onLoad() {
        // Store original scale
        this.baseScale = this.node.scale.clone();
        this.playLoopAnimation();
    }

    playLoopAnimation() {

        const scaleUp = this.baseScale.clone().multiplyScalar(0.9); // 10% smaller

        tween(this.node)
            .repeatForever(
                tween()
                    .to(0.7, { scale: scaleUp }, { easing: 'sineOut' })
                    .to(0.7, { scale: this.baseScale }, { easing: 'sineIn' })
            )
            .start();
    }
}