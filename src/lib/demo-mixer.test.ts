import {
    describe, expect, it
} from 'vitest';

import {
    mixDemo
} from './demo-mixer';
import {
    isMixerState
} from './mixer';
import {
    buildDemoProject, DEMO_LIBRARY
} from './project';

describe('demo production mixes', () => {
    it.each(['monsoon', 'winter', 'pocket'] as const)('%s uses valid groups, selective space and gentle protection without rewriting music', song => {
        const p = buildDemoProject(song);
        const {mixer, ...music} = p;
        expect(isMixerState(mixer)).toBe(true);
        expect(mixer!.master).toMatchObject({limiter: true, driveDb: 0, ceilingDb: -1});
        expect(Object.keys(mixer!.channels).sort()).toEqual(p.instruments.map(inst => inst.id).sort());
        expect(mixer!.buses.length).toBeGreaterThanOrEqual(3);
        const snapshot = JSON.stringify(music);
        mixDemo(p, song);
        const {mixer: next, ...unchanged} = p;
        expect(JSON.stringify(unchanged)).toBe(snapshot);
        expect(next).toEqual(mixer);
    });

    it('keeps Monsoon’s sub dry, puts its flute further back, and echoes only the sparse plucks', () => {
        const p = buildDemoProject('monsoon'), mixer = p.mixer!;
        const strip = (name: string) => mixer.channels[p.instruments.find(inst => inst.name.endsWith(name))!.id];
        expect(strip('Bronze Sub').reverb).toBe(0);
        expect(strip('Odaiko').reverb).toBeLessThan(strip('Shakuhachi').reverb);
        const echo = mixer.buses.find(bus => bus.effect === 'delay')!;
        expect(echo.delayTime).toBeCloseTo(60 / p.bpm * 0.75);
        const sources = p.instruments.filter(inst => mixer.channels[inst.id].sends.length);
        expect(sources.map(inst => inst.name.split('/').at(-1)).sort()).toEqual(['Handpan', 'Kora']);
        expect(sources.every(inst => mixer.channels[inst.id].sends[0].level <= 0.08)).toBe(true);
    });

    it('does not add echoes or bus compression to the period band', () => {
        const p = buildDemoProject('winter'), mixer = p.mixer!;
        expect(mixer.buses.map(bus => bus.name)).toEqual(['Ripieno strings', 'Continuo', 'Venti']);
        expect(mixer.buses.every(bus => bus.effect === 'none' && !bus.compressor.enabled)).toBe(true);
        expect(Object.values(mixer.channels).every(channel => !channel.sends.length)).toBe(true);
        const violone = p.instruments.find(inst => inst.name.endsWith('/Violone'))!;
        expect(mixer.channels[violone.id].reverb).toBe(0.15);
    });

    it('keeps the promo master protected without adding production routing', () => {
        const promo = buildDemoProject('promo');
        expect(isMixerState(promo.mixer)).toBe(true);
        expect(promo.mixer!.buses).toEqual([]);
        expect(Object.values(promo.mixer!.channels).every(channel =>
            channel.output === 'master' && channel.sends.length === 0
        )).toBe(true);
    });

    it('leaves the remaining demos on their legacy mixes', () => {
        for (const {id} of DEMO_LIBRARY) {
            if (id === 'monsoon' || id === 'winter' || id === 'pocket' || id === 'promo') {continue;}
            expect(buildDemoProject(id).mixer, id).toBeUndefined();
        }
    });
});
