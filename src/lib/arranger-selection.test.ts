import { describe, expect, it } from 'vitest';

import { shouldPlacePattern } from './arrangement';

describe('shouldPlacePattern', () => {
    it('uses the first plain click to clear an existing arranger selection', () => {
        expect(shouldPlacePattern(true, false)).toBe(false);
    });

    it('places a pattern only when no clip is selected', () => {
        expect(shouldPlacePattern(false, false)).toBe(true);
    });

    it('keeps shift-click available for additive arranger work', () => {
        expect(shouldPlacePattern(true, true)).toBe(true);
    });
});
