import {
    describe, expect, it
} from 'vitest';

import {
    buildDemoProject, DEMO_LIBRARY
} from './project';

describe('Pinky Promo demo', () => {
    it('bundles the editable trailer soundtrack in the demo library', () => {
        const promo = buildDemoProject('promo');

        expect(DEMO_LIBRARY.some(demo => demo.id === 'promo')).toBe(true);
        expect(promo.bpm).toBe(100);
        expect(Math.max(...promo.arrangement.map(clip => clip.start + clip.len))).toBe(336);
        expect(promo.instruments.map(instrument => instrument.name)).toEqual(expect.arrayContaining([
            'FX/Air', 'Bass/Sub', 'Vocals/Choir (oo)', 'Synth/Pluck', 'Vocals/Soprano (ah)'
        ]));
    });

    it('keeps the promo’s intro, groove, break, climax, and final hit editable as named sections', () => {
        const promo = buildDemoProject('promo');
        const patternsAt = (step: number) => promo.arrangement
            .filter(clip => clip.start === step)
            .map(clip => promo.patterns.find(pattern => pattern.id === clip.patternId)?.name);

        expect(patternsAt(0)).toEqual(expect.arrayContaining([
            '01 Intro/noise swell — FX & Impacts', '01 Intro/noise swell — Low End'
        ]));
        expect(patternsAt(96)).toContain('04 Groove/d minor pulse — Drums');
        expect(patternsAt(224)).toContain('12 Break/floor drops — FX & Impacts');
        expect(patternsAt(256)).toContain('13 Climax/d minor lift — Soprano');
        expect(patternsAt(304)).toContain('16 Outro/final hit — FX & Impacts');
    });

    it('uses source-calibrated faders and separately editable production lanes', () => {
        const promo = buildDemoProject('promo');
        const gain = (name: string) => promo.instruments.find(instrument => instrument.name === name)?.params.gain;

        expect(promo.tracks.map(track => track.name)).toEqual([
            '01 FX & Impacts', '02 Drums', '03 Low End', '04 Harmony', '05 Arpeggio', '06 Lead', '07 Soprano'
        ]);
        expect(gain('FX/Impact')).toBe(0.9);
        expect(gain('Drums/Kick')).toBe(0.72);
        expect(gain('Vocals/Choir (oo)')).toBe(0.2);
        expect(gain('Synth/Pluck')).toBe(0.88);
        expect(gain('Drums/Hi-Hat')).toBe(0.14);
        expect(gain('FX/Air')).toBe(0.1);
        expect(promo.automation).toHaveLength(1);
        expect(promo.automation?.[0].points).toEqual([
            {step: 0, value: 0.28, curve: 'hold'}, {step: 32, value: 0.5, curve: 'ease-in'},
            {step: 63, value: 0.71, curve: 'hold'}, {step: 64, value: 1},
            {step: 224, value: 1, curve: 'ease-out'}, {step: 226, value: 0.71, curve: 'hold'},
            {step: 255, value: 0.71, curve: 'hold'}, {step: 256, value: 1}
        ]);
    });
});
