import { describe, expect, it } from 'vitest';

import { clampPartialLevel } from './instruments';

describe('clampPartialLevel', () => {
    it('rounds manually typed levels to the partial precision', () => {
        expect(clampPartialLevel(0.537)).toBe(0.54);
    });

    it('keeps manually typed levels within the audible range', () => {
        expect(clampPartialLevel(-1)).toBe(0);
        expect(clampPartialLevel(2)).toBe(1);
    });
});
