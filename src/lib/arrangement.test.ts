import { describe, expect, it } from 'vitest';

import type { ArrangementClip, Pattern, Track } from './types';

import {
    addArrangementTrack,
    getPatternPreview,
    insertArrangementTrack,
    moveArrangementTrack,
    removeArrangementTrack,
    shouldEditAutomation,
} from './arrangement';

const pattern: Pattern = {
    id: 'melody',
    name: 'Melody',
    steps: 4,
    color: '#fff',
    tracks: {
        lead: [
            { pitch: 'C5', start: 0, len: 2 },
            { pitch: 'E5', start: 3, len: 2 },
        ],
        bass: [{ pitch: 'C4', start: 1, len: 1 }],
    },
};

describe('getPatternPreview', () => {
    it('returns no notes for a missing or empty pattern', () => {
        expect(getPatternPreview(undefined, 8)).toEqual([]);
        expect(getPatternPreview({ ...pattern, tracks: {} }, 8)).toEqual([]);
    });

    it('repeats notes across the clip and clips overflowing durations', () => {
        const preview = getPatternPreview(pattern, 6);

        expect(preview.map(({ pitch, start, len }) => ({ pitch, start, len }))).toEqual([
            { pitch: 'C5', start: 0, len: 2 },
            { pitch: 'E5', start: 3, len: 2 },
            { pitch: 'C4', start: 1, len: 1 },
            { pitch: 'C5', start: 4, len: 2 },
            { pitch: 'C4', start: 5, len: 1 },
        ]);
    });

    it('normalizes note rows to the pattern pitch range', () => {
        const preview = getPatternPreview(pattern, 4);

        expect(preview.find(note => note.pitch === 'C4')?.y).toBe(1);
        expect(preview.find(note => note.pitch === 'C5')?.y).toBe(0.25);
        expect(preview.find(note => note.pitch === 'E5')?.y).toBe(0);
    });
});

describe('shouldEditAutomation', () => {
    it('uses the first automation-lane click to clear selected clips', () => {
        expect(shouldEditAutomation(true)).toBe(false);
        expect(shouldEditAutomation(false)).toBe(true);
    });
});

describe('arrangement tracks', () => {
    const tracks: Track[] = [
        { name: 'Beat', color: '#111' },
        { name: 'Lead', color: '#222' },
        { name: 'Texture', color: '#333' },
    ];
    const arrangement: ArrangementClip[] = [
        { id: 'beat', patternId: 'p1', track: 0, start: 0, len: 16 },
        { id: 'lead', patternId: 'p2', track: 1, start: 16, len: 16 },
        { id: 'texture', patternId: 'p3', track: 2, start: 32, len: 16 },
    ];

    it('adds a named lane without moving existing clips', () => {
        const result = addArrangementTrack(tracks);

        expect(result).toHaveLength(4);
        expect(result.at(-1)).toMatchObject({ name: 'Track 4' });
        expect(arrangement.map(clip => clip.track)).toEqual([0, 1, 2]);
    });

    it('inserts a lane between existing tracks and keeps clips with their lanes', () => {
        const result = insertArrangementTrack(tracks, arrangement, 1);

        expect(result.tracks.map(track => track.name)).toEqual([
            'Beat',
            'Track 2',
            'Lead',
            'Texture',
        ]);
        expect(result.arrangement.map(clip => [clip.id, clip.track])).toEqual([
            ['beat', 0],
            ['lead', 2],
            ['texture', 3],
        ]);
    });

    it('reorders lanes without changing which lane owns each clip', () => {
        const result = moveArrangementTrack(tracks, arrangement, 0, 3);

        expect(result.tracks.map(track => track.name)).toEqual(['Lead', 'Texture', 'Beat']);
        expect(result.arrangement.map(clip => [clip.id, clip.track])).toEqual([
            ['beat', 2],
            ['lead', 0],
            ['texture', 1],
        ]);
    });

    it('removes an empty lane and compacts following clip indexes', () => {
        const result = removeArrangementTrack(tracks, [arrangement[0], arrangement[2]], 1);

        expect(result.tracks.map(track => track.name)).toEqual(['Beat', 'Texture']);
        expect(result.arrangement.map(clip => [clip.id, clip.track])).toEqual([
            ['beat', 0],
            ['texture', 1],
        ]);
    });

    it('removes clips on a deleted lane and preserves the remaining arrangement', () => {
        const result = removeArrangementTrack(tracks, arrangement, 1);

        expect(result.arrangement.map(clip => [clip.id, clip.track, clip.start, clip.len])).toEqual(
            [
                ['beat', 0, 0, 16],
                ['texture', 1, 32, 16],
            ],
        );
    });

    it('keeps the final lane intact', () => {
        const result = removeArrangementTrack([tracks[0]], [arrangement[0]], 0);

        expect(result.tracks).toEqual([tracks[0]]);
        expect(result.arrangement).toEqual([arrangement[0]]);
    });
});
