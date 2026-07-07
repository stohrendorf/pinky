/* Wake-up pulse for the sequencer, running on the audio thread.
 * It does NOT decide when a step happens any more — it only says "it is now
 * <audio time>" a few dozen times a second. Working out which steps fall into
 * the next scheduling window is the transport's job (see lib/transport.ts):
 * that way a whole window of music is queued into the future, so a garbage
 * collection or a layout spike on the main thread can no longer turn into an
 * audible gap the way a one-tick-per-step clock did. */
class ClockProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.running = false;
        this.pulseFrames = Math.max(128, Math.round(sampleRate * 0.02)); // ~20 ms
        this.nextFrame = 0;
        this.port.onmessage = ({data}) => {
            if (data.type === 'start') {
                this.running = true;
                this.nextFrame = currentFrame;
            } else if (data.type === 'stop') {
                this.running = false;
            }
        };
    }

    process() {
        if (this.running && currentFrame + 128 >= this.nextFrame) {
            this.nextFrame = currentFrame + this.pulseFrames;
            this.port.postMessage({type: 'tick', time: currentTime});
        }
        return true;
    }
}

registerProcessor('eq-daw-clock', ClockProcessor);
