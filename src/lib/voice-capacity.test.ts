import {
    describe, expect, it
} from 'vitest';

import {
    capacityForRender,
    LIVE_MAX_VOICES,
    OFFLINE_CAPACITY_MULTIPLIER,
    OFFLINE_NODE_BUDGET_MAX
} from './voice-capacity';

describe('voice capacity', () => {
    it('gives offline rendering the same governor with tenfold headroom', () => {
        expect(capacityForRender(480, false)).toEqual({nodes: 480, voices: LIVE_MAX_VOICES});
        expect(capacityForRender(480, true)).toEqual({
            nodes: 480 * OFFLINE_CAPACITY_MULTIPLIER,
            voices: LIVE_MAX_VOICES * OFFLINE_CAPACITY_MULTIPLIER
        });
    });

    it('caps offline node capacity before an accidentally huge graph can be created', () => {
        expect(capacityForRender(1200, true).nodes).toBe(OFFLINE_NODE_BUDGET_MAX);
    });
});