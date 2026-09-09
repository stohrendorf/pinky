import { describe, expect, it } from 'vitest';

import { type BandRecord, VoiceBandRegistry } from './voice-band-registry';

function record(end: number, start = 0): BandRecord {
    return {
        inst: 'lead',
        bands: [{ from: 200, target: 800, q: 2, gain: 10 }],
        level: 0.8,
        start,
        end,
        release: Infinity,
        bendStart: start,
        pitchTime: 1,
        att: 1,
        dec: 1,
        sus: 0.5,
        rel: 1,
    };
}

describe('VoiceBandRegistry', () => {
    it('renders the current envelope and bent band frequency', () => {
        const registry = new VoiceBandRegistry();
        registry.add(record(Infinity), 0);

        const snapshot = registry.snapshot(0.5);
        expect(snapshot[0].env).toBe(0.5);
        expect(snapshot[0].bands[0].freq).toBe(400);
    });

    it('removes expired records and retains held records when full', () => {
        const registry = new VoiceBandRegistry(2);
        registry.add(record(1), 0);
        registry.add(record(Infinity), 0);
        registry.add(record(Infinity, 2), 2);

        const snapshot = registry.snapshot(2);
        expect(snapshot).toHaveLength(1);
        expect(snapshot[0].bands[0].freq).toBe(800);
    });
});
