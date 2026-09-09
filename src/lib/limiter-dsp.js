// Sample-peak protection, not an inter-sample/true-peak limiter. The sliding
// maximum includes both the delayed output sample and its entire lookahead.
export const LIMITER_LOOKAHEAD = 0.005;

const bounded = (value, min, max, fallback) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export class LimiterDSP {
    constructor(sampleRate) {
        this.sampleRate = bounded(sampleRate, 8000, 384000, 48000);
        this.latencyFrames = Math.ceil(this.sampleRate * LIMITER_LOOKAHEAD);
        this.size = this.latencyFrames + 2;
        this.left = new Float32Array(this.size);
        this.right = new Float32Array(this.size);
        this.peaks = new Float64Array(this.size);
        this.times = new Float64Array(this.size);
        this.head = 0;
        this.tail = 0;
        this.frame = 0;
        this.gain = 1;
        this.enabled = true;
        this.drive = 1;
        this.ceiling = 1;
        this.release = 0;
        this.meterPeak = [0, 0];
        this.meterSquares = [0, 0];
        this.meterFrames = 0;
        this.meterReduction = 0;
        this.configure({});
    }

    configure({ enabled = true, driveDb = 0, ceilingDb = -1, release = 0.1 } = {}) {
        this.enabled = !!enabled;
        this.drive = Math.pow(10, bounded(driveDb, 0, 18, 0) / 20);
        // Leave one float32 rounding margin, so writing output cannot exceed
        // the requested ceiling even when the ideal result rounds upward.
        this.ceiling = Math.pow(10, bounded(ceilingDb, -12, 0, -1) / 20) * (1 - 1e-7);
        this.release = Math.exp(-1 / (bounded(release, 0.02, 1, 0.1) * this.sampleRate));
    }

    process(inputLeft, inputRight, outputLeft, outputRight, meter = true) {
        let minimumGain = 1;
        for (let i = 0; i < outputLeft.length; i++) {
            const l = inputLeft?.[i] ?? 0;
            const r = inputRight?.[i] ?? l;
            const left = Number.isFinite(l) ? l : 0;
            const right = Number.isFinite(r) ? r : 0;
            const n = this.frame++;
            const write = n % this.size;
            this.left[write] = left;
            this.right[write] = right;
            while (this.head !== this.tail && this.times[this.head] < n - this.latencyFrames) {
                this.head = (this.head + 1) % this.size;
            }
            const peak = Math.max(Math.abs(left), Math.abs(right));
            while (this.head !== this.tail) {
                const previous = (this.tail + this.size - 1) % this.size;
                if (this.peaks[previous] > peak) {
                    break;
                }
                this.tail = previous;
            }
            this.peaks[this.tail] = peak;
            this.times[this.tail] = n;
            this.tail = (this.tail + 1) % this.size;

            const maximum = this.peaks[this.head] * this.drive;
            const target = maximum > this.ceiling ? this.ceiling / maximum : 1;
            this.gain = Math.min(target, 1 - (1 - this.gain) * this.release);
            const gain = this.enabled ? this.gain * this.drive : 1;
            const read = (n - this.latencyFrames + this.size) % this.size;
            const outL = n >= this.latencyFrames ? this.left[read] * gain : 0;
            const outR = n >= this.latencyFrames ? this.right[read] * gain : 0;
            outputLeft[i] = outL;
            outputRight[i] = outR;
            if (meter) {
                this.meterPeak[0] = Math.max(this.meterPeak[0], Math.abs(outputLeft[i]));
                this.meterPeak[1] = Math.max(this.meterPeak[1], Math.abs(outputRight[i]));
                this.meterSquares[0] += outputLeft[i] * outputLeft[i];
                this.meterSquares[1] += outputRight[i] * outputRight[i];
                this.meterFrames++;
                if (this.enabled) {
                    minimumGain = Math.min(minimumGain, this.gain);
                }
            }
        }
        if (meter) {
            this.meterReduction = Math.max(this.meterReduction, -20 * Math.log10(minimumGain));
        }
    }

    readMeters() {
        const frames = Math.max(1, this.meterFrames);
        const result = {
            peak: [...this.meterPeak],
            rms: this.meterSquares.map(sum => Math.sqrt(sum / frames)),
            reduction: this.meterReduction,
        };
        this.meterPeak.fill(0);
        this.meterSquares.fill(0);
        this.meterFrames = 0;
        this.meterReduction = 0;
        return result;
    }
}
