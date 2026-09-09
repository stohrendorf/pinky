import { describe, expect, it } from 'vitest';

import type { DemoSong } from './project';

import { buildDemoProject } from './project';

const DEMO_SONGS: DemoSong[] = [
    'axelf',
    'toccata',
    'winter',
    'monsoon',
    'noise',
    'diva',
    'pocket',
    'chip',
    'promo',
];

describe('bundled demo hierarchy', () => {
    it.each(DEMO_SONGS)('organizes %s instruments and patterns into slash paths', song => {
        const demo = buildDemoProject(song);

        expect(demo.instruments.every(({ name }) => /^[^/]+(?:\/[^/]+)+$/.test(name))).toBe(true);
        expect(demo.patterns.every(({ name }) => /^\d{2} [^/]+\/[^/]+$/.test(name))).toBe(true);
        expect(
            demo.arrangement.every(({ patternId }) =>
                demo.patterns.some(({ id }) => id === patternId),
            ),
        ).toBe(true);
    });

    it('uses production-style sound families and song-form folders', () => {
        const toccata = buildDemoProject('toccata');

        expect(toccata.instruments.some(({ name }) => name === 'Keys/Organ')).toBe(true);
        expect(toccata.instruments.some(({ name }) => name === 'Orchestra/Strings/Cello')).toBe(
            true,
        );
        expect(toccata.patterns.find(({ name }) => name.endsWith('/finale spin'))?.name).toBe(
            '04 Climax/finale spin',
        );
    });

    it.each(DEMO_SONGS)('keeps every %s arranger track occupied and referenced', song => {
        const demo = buildDemoProject(song);

        expect(
            demo.tracks.every((_, index) => demo.arrangement.some(clip => clip.track === index)),
        ).toBe(true);
        expect(
            demo.arrangement.every(clip => clip.track >= 0 && clip.track < demo.tracks.length),
        ).toBe(true);
    });
});
