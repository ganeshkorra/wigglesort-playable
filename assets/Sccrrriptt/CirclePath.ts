import { _decorator, Component, Node, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CirclePath')
export class CirclePath extends Component {

    @property
    radius: number = 9; // Distance from center to the middle of the track

    @property
    clockwise: boolean = true;

    // Get the center of the circular track in world space
    public getCenter(): Vec3 {
        return this.node.worldPosition;
    }

    // This calculates the "forward" direction on the circle at any given point
    public getTangentAt(currentPos: Vec3): Vec3 {
        const center = this.getCenter();
        // 1. Direction from center to the snake
        let radialDir = new Vec3();
        Vec3.subtract(radialDir, currentPos, center);
        radialDir.y = 0; // Keep it on the floor
        radialDir.normalize();

        // 2. Rotate 90 degrees to get the tangent (The Road direction)
        // Tangent of (x, z) is (-z, x)
        let tangent = this.clockwise 
            ? new Vec3(-radialDir.z, 0, radialDir.x) 
            : new Vec3(radialDir.z, 0, -radialDir.x);

        return tangent.normalize();
    }
}