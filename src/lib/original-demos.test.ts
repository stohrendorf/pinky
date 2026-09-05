import {
    describe, expect, it
} from 'vitest';

import type {
    DemoSong
} from './project';

import {
    noteByName
} from './notes';
import {
    buildDemoProject
} from './project';

const instrumentTracks = (demo: ReturnType<typeof buildDemoProject>, instrumentName: string, patternName?: string) => {
    const instrument = demo.instruments.find(candidate => candidate.name === instrumentName)!;
    const patterns = patternName ? demo.patterns.filter(pattern => pattern.name === patternName) : demo.patterns;
    return patterns.flatMap(pattern => pattern.tracks[instrument.id] || []);
};

const pattern = (demo: ReturnType<typeof buildDemoProject>, name: string) =>
    demo.patterns.find(candidate => candidate.name === name)!;

const ORIGINAL_DEMOS = [
    {id: 'pocket', title: 'Pocket Theory', minInstruments: 8, minPatterns: 5},
    {id: 'chip', title: 'Bit Horizon', minInstruments: 8, minPatterns: 10}
] as const;

const songLengthInSteps = (demo: ReturnType<typeof buildDemoProject>) => Math.max(
    ...demo.arrangement.map(({start, len}) => start + len)
);

const sectionPatternIds = (demo: ReturnType<typeof buildDemoProject>) => {
    const starts = [...new Set(demo.arrangement.map(clip => clip.start))].sort((a, b) => a - b);
    return starts.map(start => demo.arrangement.filter(clip => clip.start === start).map(clip => clip.patternId).sort());
};

describe('original genre demo songs', () => {
    it.each(ORIGINAL_DEMOS)('loads $title as a complete playable project', ({id, minInstruments, minPatterns}) => {
        const demo = buildDemoProject(id);

        expect(demo.instruments.length).toBeGreaterThanOrEqual(minInstruments);
        expect(demo.patterns.length).toBeGreaterThanOrEqual(minPatterns);
        expect(demo.arrangement.length).toBeGreaterThan(8);
        expect(demo.arrangement.every(clip => demo.patterns.some(pattern => pattern.id === clip.patternId))).toBe(true);
        expect(demo.patterns.some(pattern => Object.values(pattern.tracks).some(notes => notes.length > 0))).toBe(true);
        expect(demo.automation?.some(lane => lane.points.length >= 2)).toBe(true);
    });

    it.each(ORIGINAL_DEMOS)('gives $title a full-length, evolving arrangement', ({id}) => {
        const demo = buildDemoProject(id);
        const durationInSeconds = songLengthInSteps(demo) * 60 / demo.bpm / 4;

        expect(durationInSeconds).toBeGreaterThanOrEqual(170);
        expect(demo.patterns.length).toBeGreaterThanOrEqual(10);
        expect(new Set(demo.arrangement.map(({patternId}) => patternId)).size).toBeGreaterThanOrEqual(10);
        expect(demo.arrangement.length).toBeGreaterThanOrEqual(80);
    });

    it('establishes the funk identity in the playable project data', () => {
        const pocket = buildDemoProject('pocket');
        const rhythmGuitar = pocket.instruments.find(instrument => instrument.name === 'Percussion/Shard Guitar');

        expect(rhythmGuitar).toBeDefined();
        expect(pocket.patterns.some(pattern => (pattern.tracks[rhythmGuitar!.id]?.length ?? 0) >= 8)).toBe(true);
    });

    it('ships Pocket Theory with a bass-forward palette that still reads as instruments', () => {
        const pocket = buildDemoProject('pocket');
        const bass = pocket.instruments.find(instrument => instrument.name === 'Bass/Chrome Tongue')!;
        const rhythmKeys = pocket.instruments.find(instrument => instrument.name === 'Keys/Glass Circuit')!;
        const pad = pocket.instruments.find(instrument => instrument.name === 'Pads/Choir Voltage')!;
        const lead = pocket.instruments.find(instrument => instrument.name === 'Synth/Radio Animal')!;
        const accents = pocket.instruments.find(instrument => instrument.name === 'Synth/Neon Chordbite')!;
        const shardGuitar = pocket.instruments.find(instrument => instrument.name === 'Percussion/Shard Guitar')!;
        const clap = pocket.instruments.find(instrument => instrument.name === 'Drums/Hand Clap')!;

        expect(bass.params.tone).toBe(1);
        expect(bass.params.q).toBeGreaterThan(5);
        // a bass line at 50..90 Hz is carried by its resonant bands alone — a
        // wide noise band there is hiss on every note (see timbre-analysis.ts)
        expect(bass.params.noise).toBe(0);
        expect(bass.params.q).toBeLessThanOrEqual(12);
        expect(bass.params.partials!.length).toBeGreaterThanOrEqual(5);
        expect(instrumentTracks(pocket, 'Bass/Chrome Tongue').every(note => noteByName[note.pitch].freq >= 45)).toBe(true);
        expect(pocket.instruments.some(instrument => instrument.name === 'Bass/Slap Attack')).toBe(false);
        const voices = [bass, rhythmKeys, pad, lead, accents, shardGuitar];

        expect(rhythmKeys.params.partials!.some(partial => !Number.isInteger(partial.ratio))).toBe(true);
        expect(pad.params.formant).toBeGreaterThan(0);
        expect(pad.params.voices).toBeGreaterThan(1);
        expect(lead.params.formant).toBeGreaterThan(0);
        expect(lead.params.vib).toBeGreaterThan(0);
        expect(accents.params.pitchDrop).not.toBe(0);
        expect(shardGuitar.params.noise).toBeGreaterThan(0);
        expect(new Set(voices.map(instrument => instrument.params.q)).size).toBeGreaterThanOrEqual(4);
        expect(pocket.automation?.some(lane => lane.target === lead.id && lane.param === 'gain')).toBe(true);
        expect(pocket.automation?.some(lane => lane.target === pad.id && lane.param === 'gain')).toBe(true);
        expect(clap.params.noise).toBeGreaterThan(0);
    });

    it('adds shaped expression sparingly to Pocket Theory', () => {
        const demo = buildDemoProject('pocket');
        const notes = demo.patterns.flatMap(pattern => Object.values(pattern.tracks).flat());
        const links = notes.flatMap(note => note.legatoTo ? [note.legatoTo] : []);
        const curves = (demo.automation ?? []).flatMap(lane => lane.points.map(point => point.curve).filter(Boolean));

        expect(links.length).toBeGreaterThanOrEqual(2);
        expect(links.length).toBeLessThanOrEqual(8);
        expect(links.some(link => link.curve !== 'linear')).toBe(true);
        expect(curves.some(curve => curve !== 'linear')).toBe(true);
    });

    it('keeps its original music distinct from the requested reference works', () => {
        const names = ORIGINAL_DEMOS.map(({id}) => buildDemoProject(id as DemoSong).patterns.map(pattern => pattern.name));

        expect(names.flat()).not.toContain('Mass Effect Theme');
        expect(names.flat()).not.toContain('Halo Theme');
    });

    it('gives Bit Horizon a focused chiptune palette and a developed arcade-song arc', () => {
        const demo = buildDemoProject('chip');
        const instruments = demo.instruments.map(({params}) => params);
        const notes = demo.patterns.flatMap(pattern => Object.values(pattern.tracks).flat());
        const lead = instrumentTracks(demo, 'Lead/Star Runner', '03 Flight/Star runner');
        const theme = instrumentTracks(demo, 'Lead/Star Runner', '04 Horizon/Second signal');
        const breakdown = pattern(demo, '05 Drift/Console memory');
        const curves = demo.automation!.flatMap(lane => lane.points.map(point => point.curve));
        const sections = sectionPatternIds(demo);

        expect(demo.bpm).toBeGreaterThanOrEqual(140);
        expect(demo.swing).toBe(0);
        expect(instruments.some(params => params.noise >= 0.9 && params.dec <= 0.08)).toBe(true);
        expect(instruments.some(params => params.partials?.every(partial => Number.isInteger(partial.ratio) && partial.ratio % 2 === 1))).toBe(true);
        expect(instruments.some(params => params.pitchDrop >= 18 && params.pitchTime <= 0.08)).toBe(true);
        expect(new Set(notes.map(note => note.vel)).size).toBeGreaterThanOrEqual(6);
        expect(lead.filter(note => note.legatoTo).length).toBeGreaterThanOrEqual(2);
        expect(theme.map(note => note.pitch)).not.toEqual(lead.map(note => note.pitch));
        expect(Object.keys(breakdown.tracks).length).toBeGreaterThanOrEqual(2);
        expect(demo.patterns).toHaveLength(16);
        expect(new Set(sections.map(section => section.join('|'))).size).toBeGreaterThanOrEqual(18);
        expect(sections.slice(0, 8)).not.toEqual(sections.slice(-8));
        expect(curves).toContain('hold');
        expect(curves).toContain('ease-out');
        expect(songLengthInSteps(demo)).toBeGreaterThanOrEqual(960);
    });
});
