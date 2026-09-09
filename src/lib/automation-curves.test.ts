import { describe, expect, it } from 'vitest';

import type { AutomationLane } from './types';

import { laneValueAt, segmentProgress } from './automation';

const lane = (curve: NonNullable<AutomationLane['points'][number]['curve']>): AutomationLane => ({
    id: 'tone',
    target: 'instrument',
    param: 'tone',
    points: [
        { step: 0, value: 0, curve },
        { step: 8, value: 1 },
    ],
});

describe('automation curve presets', () => {
    it('keeps unconfigured segments linear by default', () => {
        expect(
            laneValueAt(
                {
                    ...lane('linear'),
                    points: [
                        { step: 0, value: 0 },
                        { step: 8, value: 1 },
                    ],
                },
                2,
            ),
        ).toBe(0.25);
    });

    it('evaluates hold and easing curves from the outgoing point', () => {
        expect(laneValueAt(lane('hold'), 4)).toBe(0);
        expect(laneValueAt(lane('ease-in'), 2)).toBe(0.0625);
        expect(laneValueAt(lane('ease-out'), 2)).toBe(0.4375);
        expect(laneValueAt(lane('smooth'), 2)).toBeCloseTo(0.15625);
        expect(segmentProgress('smooth', 0.5)).toBe(0.5);
    });
});
