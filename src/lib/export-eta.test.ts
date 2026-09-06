import {
    describe, expect, it, vi
} from 'vitest';

import {
    createExportEta, formatStageEta
} from './export-eta';

function fixture() {
    let time = 0;
    const estimator = createExportEta(() => time);
    return {estimator, sample: (at: number, progress: number | null, stage = 'rendering') => {
        time = at;
        return estimator.update(stage, progress);
    }};
}

describe('stage-local export ETA', () => {
    it('waits for at least a second and meaningful observed progress', () => {
        const {sample} = fixture();
        expect(sample(0, 0)).toBeNull();
        expect(sample(500, 0.002)).toBeNull();
        expect(sample(999, 0.005)).toBeNull();
        expect(sample(1000, 0.006)).toBeNull();
        expect(sample(1500, 0.02)).toBeGreaterThan(0);
    });

    it('produces finite decreasing estimates for monotone frames at a steady speed', () => {
        const {sample} = fixture();
        const totalFrames = 4410000;
        expect(sample(0, 0)).toBeNull();
        let previous = Infinity;
        for (let i = 1; i < 10; i++) {
            const frames = i * 441000;
            const estimate = sample(i * 1000, frames / totalFrames);
            expect(estimate).not.toBeNull();
            expect(Number.isFinite(estimate)).toBe(true);
            expect(estimate).toBeGreaterThanOrEqual(0);
            expect(estimate).toBeLessThan(previous);
            expect(estimate).toBeCloseTo(10 - i);
            previous = estimate!;
        }
        expect(sample(10000, 1)).toBeNull();
    });

    it('smooths speed changes rather than using the latest interval alone', () => {
        const {sample} = fixture();
        sample(0, 0);
        expect(sample(1000, 0.1)).toBeCloseTo(9);
        const faster = sample(2000, 0.3)!;
        expect(faster).toBeGreaterThan(0.7 / 0.2);
        expect(faster).toBeLessThan(0.7 / 0.1);
        const slower = sample(3000, 0.35)!;
        expect(slower).toBeGreaterThan(0.65 / (0.7 / faster));
        expect(slower).toBeLessThan(0.65 / 0.05);
    });

    it('resets warmup and speed for encoding and for a new export', () => {
        const {sample, estimator} = fixture();
        sample(0, 0);
        expect(sample(1000, 0.1)).toBeCloseTo(9);
        expect(sample(1100, 0, 'encoding')).toBeNull();
        expect(sample(1600, 0.1, 'encoding')).toBeNull();
        expect(sample(2100, 0.2, 'encoding')).toBeCloseTo(4);
        estimator.reset();
        expect(sample(10000, 0.2, 'encoding')).toBeNull();
        expect(sample(10500, 0.3, 'encoding')).toBeNull();
        expect(sample(11000, 0.4, 'encoding')).toBeCloseTo(3);
    });

    it('never infers progress or counts down an ETA from elapsed time alone', () => {
        const {sample} = fixture();
        expect(sample(0, null)).toBeNull();
        expect(sample(60000, null)).toBeNull();
        expect(sample(61000, 0)).toBeNull();
        expect(sample(62000, 0)).toBeNull();
        expect(sample(63000, 0.1)).toBeCloseTo(18);
        expect(sample(64000, 0.1)).toBeNull();
        expect(sample(120000, 0.1)).toBeNull();
        expect(sample(121000, 0.2)).toBeGreaterThan(400);
        expect(sample(122000, null)).toBeNull();
        expect(sample(123000, 0.3)).toBeNull();
    });

    it('needs a second sample even if the first frame count arrives late', () => {
        const {sample} = fixture();
        expect(sample(0, null)).toBeNull();
        expect(sample(20000, 0.5)).toBeNull();
        expect(sample(20500, 0.6)).toBeNull();
        expect(sample(21000, 0.7)).toBeCloseTo(1.5);
    });

    it('does not show an ETA for very short stages or completed work', () => {
        const {sample} = fixture();
        expect(sample(0, 0)).toBeNull();
        expect(sample(100, 0.5)).toBeNull();
        expect(sample(200, 1)).toBeNull();
        expect(sample(5000, 1)).toBeNull();
    });

    it('rejects invalid inputs and starts fresh after regressing frames or timestamps', () => {
        const {sample} = fixture();
        for (const progress of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
            expect(sample(1000, progress)).toBeNull();
        }
        expect(sample(NaN, 0)).toBeNull();
        expect(sample(2000, 0.2)).toBeNull();
        expect(sample(3000, 0.3)).toBeCloseTo(7);
        expect(sample(4000, 0.1)).toBeNull();
        expect(sample(5000, 0.2)).toBeCloseTo(8);
        expect(sample(4500, 0.25)).toBeNull();
        expect(sample(4500, 0.3)).toBeNull();
        expect(sample(5500, 0.35)).toBeCloseTo(6.5);
    });

    it('defaults to the monotonic performance clock', () => {
        const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1000);
        try {
            const estimator = createExportEta();
            expect(estimator.update('rendering', 0)).toBeNull();
            expect(estimator.update('rendering', 0.1)).toBeCloseTo(9);
        } finally {clock.mockRestore();}
    });
});

describe('stage ETA formatting', () => {
    it.each<[number, string]>([
        [0, '1 s'], [3.4, '3 s'], [12, '10 s'], [58, '1 min'], [125, '2 min'], [3590, '1 h'], [7500, '2 h']
    ])('formats %s seconds as a short approximate stage duration', (seconds, duration) => {
        expect(formatStageEta(seconds)).toBe(`Approx. ${duration} left in this stage`);
    });

    it.each([null, undefined, NaN, Infinity, -1])('hides unavailable or invalid estimates (%s)', seconds => {
        expect(formatStageEta(seconds)).toBeNull();
    });
});