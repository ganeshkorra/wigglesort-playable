import { _decorator, Component } from 'cc';
const { ccclass } = _decorator;

@ccclass('ALAnalytics')
export class ALAnalytics {

    private static send(eventName: string) {
        // AppLovin Global Safety Check
        if (typeof (window as any).ALPlayableAnalytics !== 'undefined') {
            (window as any).ALPlayableAnalytics.trackEvent(eventName);
            console.log("%c AppLovin Event Sent: " + eventName, "color: #00ff00; font-weight: bold;");
        } else {
            console.warn("ALPlayableAnalytics not found. Testing Mode: " + eventName);
        }
    }

    // --- Loading & Initialization ---
    static loading() { this.send("LOADING"); }
    static loaded() { this.send("LOADED"); }
    static displayed() { this.send("DISPLAYED"); }

    // --- Challenge / Gameplay Progression ---
    static challengeStarted() { this.send("CHALLENGE_STARTED"); }
    static challengePass25() { this.send("CHALLENGE_PASS_25"); }
    static challengePass50() { this.send("CHALLENGE_PASS_50"); }
    static challengePass75() { this.send("CHALLENGE_PASS_75"); }
    static challengeSolved() { this.send("CHALLENGE_SOLVED"); }
    static challengeFailed() { this.send("CHALLENGE_FAILED"); }
    static challengeRetry() { this.send("CHALLENGE_RETRY"); }

    // --- Conversion Events ---
    static endcardShown() { this.send("ENDCARD_SHOWN"); }
    static ctaClicked() { this.send("CTA_CLICKED"); }
}