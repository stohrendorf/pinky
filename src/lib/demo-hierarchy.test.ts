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
        expect(demo.patterns.every(({ name }) => /^\d{2} [^/]+(?:\/[^/]+)+$/.test(name))).toBe(
            true,
        );
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

    it.each([
        ['axelf', '02 Main/Drums/beat', '02 Main/Bass/bass F'],
        ['toccata', '02 Main/Keys/toccata spin A', '02 Main/Bass/pedal D 8ths'],
        ['noise', '02 Main/FX/wind', '02 Main/Vocals/theme call'],
        ['diva', '02 Main/Lead Vocal/Aria I — Diva', '02 Main/Choir/Aria I — Choir'],
    ] as const)(
        'loads %s nested role groups without changing leaf names',
        (song, first, second) => {
            const names = buildDemoProject(song).patterns.map(pattern => pattern.name);

            expect(names).toEqual(expect.arrayContaining([first, second]));
        },
    );

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
