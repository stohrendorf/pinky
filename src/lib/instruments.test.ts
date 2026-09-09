import { describe, expect, it } from 'vitest';

import { PRESETS } from './instruments';

describe('built-in instrument presets', () => {
    it('preserves the persisted voice preset identifiers', () => {
        expect(PRESETS).toHaveProperty('Voice — Soprano (ah)');
        expect(PRESETS).toHaveProperty('Voice — Choir (oo)');
    });
});
