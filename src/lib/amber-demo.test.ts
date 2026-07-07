import {
    describe, expect, it
} from 'vitest';

import amberJson from '../../pinky-amber.json';
import {
    buildDemoProject
} from './project';

describe('Amber Hours demo', () => {
    const amber = buildDemoProject('amber');
    const songEnd = Math.max(...amber.arrangement.map(clip => clip.start + clip.len));
    const vinyl = amber.instruments.find(instrument => instrument.name === 'FX/Vinyl Noise')!;

    it('is a four-minute, gently swung ambient arrangement', () => {
        expect(amber.bpm).toBe(74);
        expect(amber.swing).toBe(0.18);
        expect(songEnd).toBe(1184);
        expect(songEnd * 60 / amber.bpm / 4).toBeCloseTo(240, 0);
        expect(new Set(amber.arrangement.map(clip => clip.track)).size).toBeGreaterThanOrEqual(4);
        expect(amber.arrangement.some(clip => clip.transpose && clip.transpose !== 0)).toBe(true);
    });

    it('uses the synthesis palette expressively without forcing every feature', () => {
        const params = amber.instruments.map(instrument => instrument.params);
        const velocities = amber.patterns.flatMap(pattern =>
            Object.values(pattern.tracks).flatMap(notes => notes.map(note => note.vel ?? 1))
        );

        expect(amber.instruments.length).toBeGreaterThanOrEqual(9);
        expect(params.some(value => (value.partials?.length ?? 0) >= 5)).toBe(true);
        expect(params.some(value => value.voices > 1 && value.detune > 0)).toBe(true);
        expect(params.some(value => value.noise > 0)).toBe(true);
        expect(params.some(value => value.formant > 0)).toBe(true);
        expect(params.some(value => value.vib > 0)).toBe(true);
        expect(new Set(velocities).size).toBeGreaterThan(8);
    });

    it('keeps the texture quiet and adds distinctive tonal colors', () => {
        const textureAutomation = amber.automation?.find(lane => lane.target === vinyl.id && lane.param === 'gain');
        const addedColors = amber.instruments.filter(instrument => ['Synth/Tape Pad', 'Percussion/Tuned/Rain Chime'].includes(instrument.name));
        const usedInstrumentIds = new Set(amber.patterns.flatMap(pattern => Object.keys(pattern.tracks)));

        expect(vinyl?.params.noise).toBeLessThanOrEqual(0.25);
        expect(vinyl?.params.gain).toBeLessThanOrEqual(0.12);
        expect(Math.max(...(textureAutomation?.points.map(point => point.value) ?? [1]))).toBeLessThanOrEqual(0.15);
        expect(addedColors.map(instrument => instrument.name)).toEqual([
            'Synth/Tape Pad',
            'Percussion/Tuned/Rain Chime'
        ]);
        expect(addedColors.every(instrument => usedInstrumentIds.has(instrument.id))).toBe(true);
    });

    it('keeps five slow automation gestures valid and within the song', () => {
        expect(amber.automation).toHaveLength(5);
        expect(amber.automation?.map(lane => `${lane.target}:${lane.param}`)).toEqual([
            'master:vol',
            'master:rev',
            'master:tilt',
            `${vinyl!.id}:gain`,
            `${amber.instruments.find(instrument => instrument.name === 'Synth/Tape Pad')!.id}:vib`
        ]);
        for (const lane of amber.automation ?? []) {
            expect(lane.points).toEqual([...lane.points].sort((a, b) => a.step - b.step));
            expect(lane.points.every(point => point.step >= 0 && point.step <= songEnd)).toBe(true);
        }
    });

    it('ships source data with professional paths and no dangling references', () => {
        const instrumentIds = new Set(amberJson.instruments.map(instrument => instrument.id));
        const patternIds = new Set(amberJson.patterns.map(pattern => pattern.id));

        expect(amberJson.instruments.every(instrument => /^[^/]+(?:\/[^/]+)+$/.test(instrument.name))).toBe(true);
        expect(amberJson.patterns.every(pattern => /^\d{2} [^/]+\/[^/]+$/.test(pattern.name))).toBe(true);
        expect(amberJson.patterns.every(pattern => Object.keys(pattern.tracks).every(id => instrumentIds.has(id)))).toBe(true);
        expect(amberJson.arrangement.every(clip => patternIds.has(clip.patternId))).toBe(true);
        expect(amberJson.arrangement.every(clip => clip.track >= 0 && clip.track < amberJson.tracks.length)).toBe(true);
    });
});