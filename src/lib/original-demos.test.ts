import {
    describe, expect, it
} from 'vitest';

import type {
    DemoSong
} from './project';

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
    {id: 'relay', title: 'Relay Dawn', minInstruments: 8, minPatterns: 6},
    {id: 'frontier', title: 'Far Horizon', minInstruments: 8, minPatterns: 6},
    {id: 'pocket', title: 'Pocket Theory', minInstruments: 8, minPatterns: 5},
    {id: 'velvet', title: 'Velvet Spurs', minInstruments: 10, minPatterns: 14},
    {id: 'prism', title: 'Prism Circuit', minInstruments: 12, minPatterns: 12},
    {id: 'chip', title: 'Bit Horizon', minInstruments: 8, minPatterns: 10}
] as const;

const songLengthInSteps = (demo: ReturnType<typeof buildDemoProject>) => Math.max(
    ...demo.arrangement.map(({start, len}) => start + len)
);

const sectionPatternIds = (demo: ReturnType<typeof buildDemoProject>) => {
    const starts = [...new Set(demo.arrangement.map(clip => clip.start))].sort((a, b) => a - b);
    return starts.map(start => demo.arrangement.filter(clip => clip.start === start).map(clip => clip.patternId).sort());
};

const connectedTransitionRatio = (demo: ReturnType<typeof buildDemoProject>) => {
    const sections = sectionPatternIds(demo);
    const connected = sections.slice(1).filter((section, index) => section.some(id => sections[index].includes(id)));
    return connected.length / (sections.length - 1);
};

const PITCH_CLASSES: Record<string, number> = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const pitchClass = (pitch: string) => (PITCH_CLASSES[pitch[0]] + (pitch[1] === '#' ? 1 : 0)) % 12;
const normalizedPitchContour = (pitches: string[]) => {
    const root = pitchClass(pitches[0]);
    return pitches.map(pitch => (pitchClass(pitch) - root + 12) % 12);
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

    it('establishes each genre identity in the playable project data', () => {
        const relay = buildDemoProject('relay');
        const relayOpeningPatterns = relay.patterns.filter(pattern =>
            relay.arrangement.some(clip => clip.start < 64 && clip.patternId === pattern.id)
        );
        const frontier = buildDemoProject('frontier');
        const frontierOpeningPatterns = frontier.patterns.filter(pattern =>
            frontier.arrangement.some(clip => clip.start < 64 && clip.patternId === pattern.id)
        );
        const pocket = buildDemoProject('pocket');
        const rhythmGuitar = pocket.instruments.find(instrument => instrument.name === 'Percussion/Shard Guitar');

        expect(relayOpeningPatterns.some(pattern => instrumentTracks({
            ...relay,
            patterns: [pattern]
        }, 'Synth/Relay Pluck').length >= 12)).toBe(true);
        expect(frontierOpeningPatterns.some(pattern =>
            instrumentTracks({...frontier, patterns: [pattern]}, 'Vocals/Beacon Choir').length >= 6
            && instrumentTracks({...frontier, patterns: [pattern]}, 'Vocals/Beacon Choir').every(note => note.len >= 2)
        )).toBe(true);
        expect(rhythmGuitar).toBeDefined();
        expect(pocket.patterns.some(pattern => (pattern.tracks[rhythmGuitar!.id]?.length ?? 0) >= 8)).toBe(true);
    });

    it('ships Pocket Theory with an intentionally extreme bass-forward spectral palette', () => {
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
        expect(bass.params.noise).toBeLessThanOrEqual(0.15);
        expect(bass.params.partials!.length).toBeGreaterThanOrEqual(5);
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

    it('fuses blues, soul and cinematic flamenco traits in Velvet Spurs', () => {
        const demo = buildDemoProject('velvet');
        const bass = instrumentTracks(demo, 'Bass/Upright Shadow', '02 Back Alley/shuffle pocket');
        const castanets = instrumentTracks(demo, 'Percussion/Castanet Sparks', '04 Rooftop/castanet chase');
        const organ = instrumentTracks(demo, 'Keys/Midnight Organ', '05 Testimony/gospel lift');
        const voice = instrumentTracks(demo, 'Vocals/Smoke Cry', '03 Velvet Room/smoke cry');

        expect(demo.swing).toBeGreaterThan(0.6);
        expect(bass.slice(0, 5).map(note => note.pitch)).toEqual(['D2', 'A2', 'C3', 'B2', 'A#2']);
        expect(castanets.length).toBeGreaterThanOrEqual(16);
        expect(organ.length).toBeGreaterThanOrEqual(12);
        expect(voice.some(note => note.pitch === 'G#4')).toBe(true);
        expect(demo.instruments.find(instrument => instrument.name === 'Vocals/Smoke Cry')?.params.formant)
            .toBeGreaterThan(0.5);
    });

    it.each([
        {id: 'relay', climaxPatternName: '05 Outro/Transmission return'},
        {id: 'frontier', climaxPatternName: '04 Climax/Final oath'}
    ] as const)('gives $id a connected arc with a sustained, non-recycled ending', ({id, climaxPatternName}) => {
        const demo = buildDemoProject(id);
        const sections = sectionPatternIds(demo);
        const climaxPattern = pattern(demo, climaxPatternName);
        const climaxSections = demo.arrangement.filter(clip => clip.patternId === climaxPattern.id && clip.start >= 30 * 32);

        expect(sections.slice(-2)).not.toEqual(sections.slice(0, 2));
        expect(connectedTransitionRatio(demo)).toBeGreaterThan(0.6);
        expect(climaxSections.length).toBeGreaterThanOrEqual(4);
    });

    it('uses distinct harmonic foundations for the two cinematic demos', () => {
        const relay = buildDemoProject('relay');
        const frontier = buildDemoProject('frontier');
        const relayBass = instrumentTracks(relay, 'Bass/Sub Anchor', '02 Main/Relay pulse');
        const frontierBass = instrumentTracks(frontier, 'Bass/Ranger Bass', '02 Main/Forward march');

        expect(normalizedPitchContour(relayBass.slice(0, 4).map(note => note.pitch)))
            .not.toEqual(normalizedPitchContour(frontierBass.slice(0, 4).map(note => note.pitch)));
    });

    it.each(['relay', 'frontier', 'pocket'] as const)('adds shaped expression sparingly to %s', id => {
        const demo = buildDemoProject(id);
        const notes = demo.patterns.flatMap(pattern => Object.values(pattern.tracks).flat());
        const links = notes.flatMap(note => note.legatoTo ? [note.legatoTo] : []);
        const curves = (demo.automation ?? []).flatMap(lane => lane.points.map(point => point.curve).filter(Boolean));

        expect(links.length).toBeGreaterThanOrEqual(2);
        expect(links.length).toBeLessThanOrEqual(8);
        expect(links.some(link => link.curve !== 'linear')).toBe(true);
        expect(curves.some(curve => curve !== 'linear')).toBe(true);
    });

    it('develops Far Horizon’s opening cantus into a distinct final oath', () => {
        const frontier = buildDemoProject('frontier');
        const opening = instrumentTracks(frontier, 'Vocals/Beacon Choir', '02 Main/Cantus beacon');
        const command = frontier.patterns.find(pattern => pattern.name.endsWith('/Command ascent'))!;
        const final = frontier.patterns.find(pattern => pattern.name.endsWith('/Final oath'))!;
        const finalChoir = instrumentTracks(frontier, 'Vocals/Beacon Choir', '04 Climax/Final oath');

        expect(final.id).not.toBe(command.id);
        expect(finalChoir.length).toBeGreaterThanOrEqual(8);
        expect(finalChoir.map(note => note.pitch)).not.toEqual(opening.map(note => note.pitch));
        expect(normalizedPitchContour(finalChoir.map(note => note.pitch)))
            .toEqual(normalizedPitchContour(opening.map(note => note.pitch)));
    });

    it('keeps its original music distinct from the requested reference works', () => {
        const names = ORIGINAL_DEMOS.map(({id}) => buildDemoProject(id as DemoSong).patterns.map(pattern => pattern.name));

        expect(names.flat()).not.toContain('Mass Effect Theme');
        expect(names.flat()).not.toContain('Halo Theme');
    });

    it('uses the expressive feature set as musical detail throughout Prism Circuit', () => {
        const demo = buildDemoProject('prism');
        const instruments = demo.instruments.map(({params}) => params);
        const notes = demo.patterns.flatMap(pattern => Object.values(pattern.tracks).flat());
        const curves = new Set(demo.automation?.flatMap(lane => lane.points.map(point => point.curve).filter(Boolean)));
        const automatedParams = new Set(demo.automation?.map(lane => `${lane.target === 'master' ? 'master' : 'instrument'}:${lane.param}`));
        const legatoLinks = notes.flatMap(note => note.legatoTo ? [note.legatoTo] : []);

        expect(demo.swing).toBeGreaterThan(0);
        expect(new Set(demo.arrangement.map(clip => clip.track)).size).toBe(demo.tracks.length);
        expect(demo.arrangement.some(clip => clip.transpose)).toBe(true);
        expect(new Set(notes.map(note => note.vel)).size).toBeGreaterThan(8);
        expect(instruments.some(params => params.noise >= 0.8 && params.pitchDrop !== 0 && params.noiseBend > 0)).toBe(true);
        expect(instruments.some(params => params.formant > 0 && params.vib > 0)).toBe(true);
        expect(instruments.some(params => params.voices >= 4 && params.detune >= 24)).toBe(true);
        expect(instruments.some(params => params.partials?.some(partial => !Number.isInteger(partial.ratio)))).toBe(true);
        expect(instruments.some(params => Math.abs(params.pan) >= 0.25)).toBe(true);
        expect(legatoLinks.some(link => link.curve !== 'linear')).toBe(true);
        expect(curves).toEqual(new Set(['hold', 'linear', 'ease-in', 'ease-out', 'smooth']));
        expect([...automatedParams]).toEqual(expect.arrayContaining([
            'master:vol', 'master:rev', 'master:tilt', 'instrument:tone', 'instrument:formant', 'instrument:pan'
        ]));
    });

    it('gives Prism Circuit a coherent harmonic spine and a developed lead motif', () => {
        const demo = buildDemoProject('prism');
        const pulse = instrumentTracks(demo, 'Bass/Carbon Current', '02 Pulse/Carbon bass');
        const motif = instrumentTracks(demo, 'Synth/Facet Lead', '03 Bloom/Facet theme');

        expect([0, 8, 16, 24].map(start => pulse.find(note => note.start === start)?.pitch))
            .toEqual(['A1', 'G1', 'F1', 'E1']);
        expect(motif).toHaveLength(8);
        expect(motif.filter(note => note.legatoTo).length).toBeGreaterThanOrEqual(4);
        expect(motif.every((note, index) => index === motif.length - 1 || note.start + note.len <= motif[index + 1].start)).toBe(true);
    });

    it('keeps every Prism Circuit portamento target at or after its source end', () => {
        const demo = buildDemoProject('prism');

        demo.patterns.flatMap(pattern => Object.values(pattern.tracks).flat()).forEach(source => {
            if (!source.legatoTo) {return;}
            expect(source.legatoTo.start).toBeGreaterThanOrEqual(source.start + source.len);
        });
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