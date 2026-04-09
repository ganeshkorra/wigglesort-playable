import { _decorator, Component, AudioSource, find, CCString, sys } from 'cc';
import { ALAnalytics } from './ALAnalytics'; // Double check your filename matches
import { GameManager } from './GameManager';

// Standard MRAID declaration
declare const mraid: any;

const { ccclass, property } = _decorator;

@ccclass('CTAButtonHandler')
export class CTAButtonHandler extends Component {
    
    @property({
        type: CCString,
        tooltip: 'Default Android Play Store URL'
    })
    public androidStoreUrl: string = "https://play.google.com/store/apps/details?id=com.luwukmeliana.profileperfect";

    @property({
        type: CCString,
        tooltip: 'Default iOS App Store URL'
    })
    public iosStoreUrl: string = "https://play.google.com/store/apps/details?id=com.luwukmeliana.profileperfect";

    private isMraidReady: boolean = false;

    onLoad() {
        // AppLovin/MRAID initialization
        if (typeof mraid !== 'undefined') {
            if (mraid.getState() === 'loading') {
                mraid.addEventListener('ready', this.onMraidReady.bind(this));
            } else {
                this.onMraidReady();
            }
        }
    }

    private onMraidReady(): void {
        this.isMraidReady = true;
    }

    private getTargetStoreUrl(): string {
        // Auto-switch based on User Device
        if (sys.os === sys.OS.IOS) {
            return this.iosStoreUrl;
        } else {
            return this.androidStoreUrl;
        }
    }

    /**
     * ATTACH THIS TO YOUR BUTTON EVENT IN COCOS INSPECTOR
     */
    public onStoreButtonClicked(): void {
        const targetUrl = this.getTargetStoreUrl();
        
        // 1. TRACK ANALYTICS
        ALAnalytics.ctaClicked();

        // 2. TECHNICAL: Stop Game Music & Timer
        if (GameManager.instance) {
            // Stops BGM from the GameManager component
            if (GameManager.instance.audioSource) {
                GameManager.instance.audioSource.stop();
            }
            // Logic to prevent snakes from moving while window is opening
            GameManager.instance.isTimerRunning = false; 
        }

        // 3. REDIRECT Logic
        if (typeof mraid !== 'undefined' && typeof mraid.open === 'function') {
            console.log("MRAID Redirecting to:", targetUrl);
            mraid.open(targetUrl);
        } 
        else {
            console.log("Web browser redirecting to:", targetUrl);
            window.open(targetUrl, "_blank");
        }
    }
}