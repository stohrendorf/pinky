import {
    describe, expect, it
} from 'vitest';

import {
    filterMagnitude, filterResponseCurve, pinkNoisePower, unisonFilterMagnitude
} from './filter-response';
import {
    DEFAULT_PARAMS
} from './instruments';
import {
    noteByName
} from './notes';

describe('filterMagnitude', () => {
    it('models a stronger response at the fundamental than away from its resonant bands', () => {
        const params = {...DEFAULT_PARAMS, partials: [{ratio: 1, level: 1}]};

        expect(filterMagnitude(params, 'C4', 261.63)).toBeGreaterThan(filterMagnitude(params, 'C4', 1000));
    });

    it('returns silence when every source band is disabled', () => {
        const params = {...DEFAULT_PARAMS, tone: 0, noise: 0, formant: 0};

        expect(filterMagnitude(params, 'C4', 261.63)).toBe(0);
    });

    it('returns a finite, ordered curve for the default C4 preview', () => {
        const curve = filterResponseCurve(DEFAULT_PARAMS, 'C4', 12);

        expect(curve.length).toBeGreaterThanOrEqual(12);
        expect(curve.every(point => Number.isFinite(point.magnitude))).toBe(true);
        expect(curve[0].frequency).toBeLessThan(curve[11].frequency);
    });

    it('samples a low, narrow resonance at its exact center between display-grid samples', () => {
        const params = {...DEFAULT_PARAMS, q: 70, partials: [{ratio: 1, level: 1}]};
        const fundamental = noteByName.C4.freq;
        const curve = filterResponseCurve(params, 'C4', 360);

        expect(curve.some(point => point.frequency === fundamental)).toBe(true);
    });

    it('keeps a low-note filter response stable across octaves', () => {
        const params = {
            ...DEFAULT_PARAMS,
            q: 39,
            partials: [
                {ratio: 1, level: 1}, {ratio: 2, level: 1}, {ratio: 3, level: 0.75}, {ratio: 4, level: 0.9},
                {ratio: 6, level: 0.6}, {ratio: 8, level: 0.5}, {ratio: 10, level: 0.35}, {ratio: 16, level: 0.3}
            ]
        };

        const c0 = 20 * Math.log10(filterMagnitude(params, 'C0', noteByName.C0.freq));
        const c2 = 20 * Math.log10(filterMagnitude(params, 'C2', noteByName.C2.freq));

        expect(c0).toBeCloseTo(c2, 1);
    });

    it('includes the exact detuned centers of every unison rank', () => {
        const params = {...DEFAULT_PARAMS, q: 90, voices: 2, detune: 80, partials: [{ratio: 1, level: 1}]};
        const fundamental = noteByName.C4.freq;
        const lowerRank = fundamental * Math.pow(2, -40 / 1200);
        const upperRank = fundamental * Math.pow(2, 40 / 1200);
        const curve = filterResponseCurve(params, 'C4', 24);

        expect(curve.map(point => point.frequency)).toEqual(expect.arrayContaining([lowerRank, upperRank]));
    });

    it('adds detuned unison ranks as stereo spectrum power', () => {
        const params = {...DEFAULT_PARAMS, q: 20, voices: 2, detune: 80, partials: [{ratio: 1, level: 1}]};
        const frequency = noteByName.C4.freq;
        const response = unisonFilterMagnitude(params, 'C4', frequency);
        const gain = 40 * params.tone;
        const rankResponse = (cents: number) => {
            const center = frequency * Math.pow(2, cents / 1200);
            const w0 = 2 * Math.PI * center / 48000;
            const a = Math.pow(10, gain / 40);
            const alpha = Math.sin(w0) / (2 * params.q);
            const cosine = -2 * Math.cos(w0);
            const a0 = 1 + alpha / a;
            const b0 = (1 + alpha * a) / a0;
            const b1 = cosine / a0;
            const b2 = (1 - alpha * a) / a0;
            const a1 = cosine / a0;
            const a2 = (1 - alpha / a) / a0;
            const w = 2 * Math.PI * frequency / 48000;
            const z1r = Math.cos(w), z1i = -Math.sin(w);
            const z2r = Math.cos(2 * w), z2i = -Math.sin(2 * w);
            const nr = b0 + b1 * z1r + b2 * z2r;
            const ni = b1 * z1i + b2 * z2i;
            const dr = 1 + a1 * z1r + a2 * z2r;
            const di = a1 * z1i + a2 * z2i;
            const den = dr * dr + di * di;
            return {real: (nr * dr + ni * di) / den - 1, imaginary: (ni * dr - nr * di) / den};
        };
        const lower = rankResponse(-40);
        const upper = rankResponse(40);
        const expected = Math.sqrt((lower.real * lower.real + lower.imaginary * lower.imaginary
            + upper.real * upper.real + upper.imaginary * upper.imaginary) / 2);

        expect(response).toBeCloseTo(expected, 12);
    });

    it('uses the source generator response instead of an idealized pink-noise slope', () => {
        const low = pinkNoisePower(55, 48000);
        const middle = pinkNoisePower(1000, 48000);
        const high = pinkNoisePower(10000, 48000);

        expect(low).toBeGreaterThan(middle);
        expect(middle).toBeGreaterThan(high);
    });

    it('uses a logarithmic frequency range suited to the filter preview', () => {
        const curve = filterResponseCurve({...DEFAULT_PARAMS, tone: 0}, 'C4', 5, 48000);

        expect(curve.map(point => point.frequency)).toEqual([
            20,
            expect.closeTo(98.98, 2),
            expect.closeTo(489.9, 2),
            expect.closeTo(2424.62, 2),
            12000
        ]);
    });

    it('uses logarithmic spacing so the preview resolves low-frequency resonances', () => {
        const curve = filterResponseCurve({...DEFAULT_PARAMS, tone: 0}, 'C4', 5, 48000);

        expect(curve[1].frequency).toBeCloseTo(98.98, 2);
    });
});