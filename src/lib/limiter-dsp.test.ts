import { describe, expect, it } from 'vitest';

import { LimiterDSP } from './limiter-dsp.js';

function render(dsp: LimiterDSP, left: Float32Array, right = left, block = 128, meter = true) {
    const l = new Float32Array(left.length + dsp.latencyFrames);
    const r = new Float32Array(l.length);
    for (let offset = 0; offset < l.length; offset += block) {
        dsp.process(
            left.subarray(offset, offset + block),
            right.subarray(offset, offset + block),
            l.subarray(offset, offset + block),
            r.subarray(offset, offset + block),
            meter,
        );
    }
    return [l, r];
}

describe('sample-peak stereo-linked lookahead limiter DSP', () => {
    it.each([44100, 48000, 96000])(
        'catches the first, isolated, block-boundary and final spikes at %i Hz',
        rate => {
            const dsp = new LimiterDSP(rate);
            dsp.configure({ driveDb: 18, ceilingDb: -6, release: 0.02 });
            const input = new Float32Array(1201).fill(0.1);
            for (const i of [0, 127, 128, 239, 511, 1200]) {
                input[i] = i % 2 ? -100 : 100;
            }
            const [left, right] = render(dsp, input);
            const ceiling = Math.pow(10, -6 / 20);
            expect(left.slice(0, dsp.latencyFrames).every(x => x === 0)).toBe(true);
            expect(left.every(x => Number.isFinite(x) && Math.abs(x) <= ceiling)).toBe(true);
            expect(right).toEqual(left);
            expect(Math.abs(left[left.length - 1])).toBeCloseTo(ceiling, 5);
            expect(dsp.readMeters().reduction).toBeGreaterThan(40);
        },
    );

    it('uses one gain for both channels without collapsing stereo or opposite polarity', () => {
        const dsp = new LimiterDSP(48000);
        const a = new Float32Array(2048).fill(4);
        const b = new Float32Array(2048).fill(-0.25);
        const [l, r] = render(dsp, a, b);
        for (let i = dsp.latencyFrames; i < l.length; i++) {
            expect(r[i] / l[i]).toBeCloseTo(-1 / 16, 6);
        }
        const meters = dsp.readMeters();
        expect(meters.peak[0]).toBeCloseTo(Math.pow(10, -1 / 20), 5);
        expect(meters.peak[1] / meters.peak[0]).toBeCloseTo(1 / 16, 6);
        expect(meters.rms[0]).toBeGreaterThan(0);
    });

    it('bypasses gain and drive exactly but keeps the same latency, including switches', () => {
        const dsp = new LimiterDSP(44100);
        dsp.configure({ enabled: false, driveDb: 18, ceilingDb: -12 });
        const input = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i) * 2);
        const [left] = render(dsp, input, input, 37);
        expect(left.slice(dsp.latencyFrames)).toEqual(input);
        expect(dsp.readMeters().reduction).toBe(0);
        dsp.configure({ enabled: true });
        expect(dsp.latencyFrames).toBe(Math.ceil(44100 * 0.005));
        expect(render(dsp, new Float32Array(1000).fill(100))[0].every(x => Math.abs(x) <= 1)).toBe(
            true,
        );
    });

    it('holds through the lookahead then releases monotonically at the configured rate', () => {
        const input = new Float32Array(48000).fill(0.1);
        input[0] = 10;
        const fast = new LimiterDSP(48000),
            slow = new LimiterDSP(48000);
        fast.configure({ ceilingDb: 0, release: 0.02 });
        slow.configure({ ceilingDb: 0, release: 1 });
        const [f] = render(fast, input),
            [s] = render(slow, input);
        for (let i = fast.latencyFrames + 2; i < f.length; i++) {
            expect(f[i]).toBeGreaterThanOrEqual(f[i - 1]);
        }
        expect(f[10000]).toBeCloseTo(0.1, 4);
        expect(s[10000]).toBeLessThan(0.04);
    });

    it('stays finite for invalid settings, non-finite input, silence and float32 extremes', () => {
        const dsp = new LimiterDSP(48000);
        dsp.configure({ driveDb: NaN, ceilingDb: Infinity, release: -1 });
        const input = Float32Array.from([NaN, Infinity, -Infinity, 3e38, -3e38, 0]);
        const [out] = render(dsp, input);
        expect(out.every(x => Number.isFinite(x) && Math.abs(x) <= 1)).toBe(true);
        const meters = dsp.readMeters();
        expect([...meters.peak, ...meters.rms, meters.reduction].every(Number.isFinite)).toBe(true);
    });

    it('is independent of render block size and can disable metering entirely offline', () => {
        const input = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i * 0.19) * (i % 311));
        const first = new LimiterDSP(48000),
            second = new LimiterDSP(48000);
        expect(render(first, input, input, 128)).toEqual(render(second, input, input, 37, false));
        expect(second.meterFrames).toBe(0);
        expect(second.readMeters()).toEqual({ peak: [0, 0], rms: [0, 0], reduction: 0 });
    });
});
