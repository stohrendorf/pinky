import {
    describe, expect, it
} from 'vitest';

import type {
    DemoSong
} from './project';

import {
    buildDemoProject
} from './project';

const JSON_DEMOS: DemoSong[] = ['axelf', 'toccata', 'noise', 'jazz', 'iron', 'suite', 'diva', 'amber'];

const instrument = (song: DemoSong, name: string) =>
    buildDemoProject(song).instruments.find(value => value.name === name)!;

const lane = (song: DemoSong, targetName: string, param: string) => {
    const demo = buildDemoProject(song);
    const target = targetName === 'master' ? 'master' : instrument(song, targetName).id;

    return demo.automation!.find(value => value.target === target && value.param === param)!;
};

describe('refined JSON demos', () => {
    it.each(JSON_DEMOS)('uses shaped automation deliberately in %s', song => {
        const demo = buildDemoProject(song);
        const shapedPoints = demo.automation!.flatMap(value => value.points).filter(point => point.curve && point.curve !== 'linear');

        expect(shapedPoints.length).toBeGreaterThanOrEqual(3);
        expect(shapedPoints.length).toBeLessThanOrEqual(24);
        expect(demo.automationOrder).toEqual(demo.automation!.map(value => value.id));
    });

    it('gives Axel F breathing pads without crowding its arrangement', () => {
        const demo = buildDemoProject('axelf');
        const pad = demo.instruments.find(value => value.name.includes('Pad'))!;
        const padMotion = demo.automation!.find(value => value.target === pad.id && value.param === 'gain');

        expect(padMotion?.points.length).toBeGreaterThanOrEqual(5);
        expect(Math.max(...padMotion!.points.map(point => point.value)) - Math.min(...padMotion!.points.map(point => point.value)))
            .toBeLessThanOrEqual(0.16);
    });

    it('develops Axel F with a distinct late lead answer', () => {
        const demo = buildDemoProject('axelf');
        const lead = demo.instruments.find(value => value.name === 'Synth/Lead Synth')!;
        const lateLeadPatterns = demo.patterns.filter(pattern =>
            demo.arrangement.some(clip => clip.patternId === pattern.id && clip.start >= 704) && pattern.tracks[lead.id]?.length
        );
        const lateLeadNotes = lateLeadPatterns.flatMap(pattern => pattern.tracks[lead.id]);

        expect(lateLeadPatterns.length).toBeGreaterThanOrEqual(2);
        expect(lateLeadNotes.length).toBeGreaterThanOrEqual(8);
    });

    it('preserves Toccata’s organ centerpiece while widening and shaping its registration', () => {
        const organ = instrument('toccata', 'Keys/Organ');
        const principal = instrument('toccata', 'Keys/Principal');

        expect(organ.name).toBe('Keys/Organ');
        expect(organ.params.partials?.some(partial => partial.ratio >= 16)).toBe(true);
        expect(organ.params.pan).toBeLessThan(0);
        expect(principal.params.pan).toBeGreaterThan(0);
        expect(buildDemoProject('toccata').automation!.some(value => value.points.some(point => point.curve === 'ease-in'))).toBe(true);
    });

    it('adds Toccata’s mixture stop only for the final registration', () => {
        const demo = buildDemoProject('toccata');
        const mixture = instrument('toccata', 'Keys/Organ/Mixture IV');
        const mixturePattern = demo.patterns.find(pattern => pattern.tracks[mixture.id]?.length)!;
        const mixtureClips = demo.arrangement.filter(clip => clip.patternId === mixturePattern.id);

        expect(mixture.name).toBe('Keys/Organ/Mixture IV');
        expect(mixture.params.partials?.filter(partial => partial.ratio >= 4).length).toBeGreaterThanOrEqual(4);
        expect(mixturePattern.tracks[mixture.id].length).toBeGreaterThanOrEqual(6);
        expect(mixtureClips.map(clip => clip.start)).toEqual([640, 672, 704]);
        expect(mixtureClips.every(clip => clip.track === 11)).toBe(true);
        expect(lane('toccata', 'Keys/Organ/Mixture IV', 'gain').points.some(point => point.curve === 'smooth')).toBe(true);
    });

    it('lets Out of Noise’s wind acquire restrained vocal motion', () => {
        const formantMotion = lane('noise', 'FX/Wind', 'formant');

        expect(formantMotion?.points.length).toBeGreaterThanOrEqual(4);
        expect(formantMotion!.points.every(point => point.value >= 0.12 && point.value <= 0.42)).toBe(true);
    });

    it('adds human expression to Smoke & Mirrors’ solo and Rhodes', () => {
        expect(instrument('jazz', 'Orchestra/Brass/Muted Trumpet').params.vib).toBeGreaterThan(0);
        expect(instrument('jazz', 'Orchestra/Brass/Muted Trumpet').params.vibDelay).toBeGreaterThan(0);
        expect(lane('jazz', 'Keys/Rhodes EP', 'detune')).toBeDefined();
    });

    it('keeps Iron Garden’s resonant and tonal sweeps forceful but controlled', () => {
        expect(Math.max(...lane('iron', 'Drums/Chord Hats', 'q').points.map(point => point.value))).toBeLessThanOrEqual(90);
        expect(lane('iron', 'master', 'tilt').points.every(point => point.value >= -6 && point.value <= 4)).toBe(true);
    });

    it('gives The Long Way Home expressive orchestral sustain', () => {
        expect(instrument('suite', 'Orchestra/Woodwinds/Solo Oboe').params.vib).toBeGreaterThan(0);
        expect(instrument('suite', 'Orchestra/Strings/Violins').params.vib).toBeGreaterThan(0);
        expect(instrument('suite', 'Orchestra/Strings/Cellos & Basses').params.rel).toBeGreaterThanOrEqual(1);
    });

    it('keeps Diva Machina’s authored formant performance visible and active', () => {
        const diva = buildDemoProject('diva');

        const formantLane = lane('diva', 'Vocals/Diva', 'f2');

        expect(diva.automationOrder).toContain(formantLane.id);
        expect(formantLane.points.some(point => point.curve === 'smooth')).toBe(true);
    });

    it('keeps Amber Hours’ vinyl behind a more readable felt sub', () => {
        const feltSub = instrument('amber', 'Bass/Felt Sub');

        expect(feltSub.params.partials?.[1].level).toBeGreaterThanOrEqual(0.22);
        expect(Math.max(...lane('amber', 'FX/Vinyl Noise', 'gain').points.map(point => point.value))).toBeLessThanOrEqual(0.1);
    });
});
