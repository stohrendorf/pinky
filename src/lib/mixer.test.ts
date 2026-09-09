import {
    describe, expect, it
} from 'vitest';

import {
    addMixerBus,
    audibleMixerIds,
    canRoute,
    createMixer,
    ensureMixer,
    isMixerState,
    MAX_MIXER_BUSES,
    mixerTailSeconds,
    removeMixerBus,
    resolveMixer
} from './mixer';
import {
    buildDemoProject, importProject, isProject, newEmptyProject, project
} from './project';
import {
    createId
} from './types';

describe('mixer project model', () => {
    it('keeps legacy projects unchanged and protects new projects by default', () => {
        const old = buildDemoProject('axelf');
        expect(old.mixer).toBeUndefined();
        expect(isProject(old)).toBe(true);
        const resolved = resolveMixer(old.mixer, old.instruments.map(inst => inst.id));
        expect(resolved.master).toMatchObject({vol: 0.8, rev: 0.18, tilt: 0, limiter: false, driveDb: 0});
        expect(Object.values(resolved.channels).every(channel => channel.volume === 1 && channel.reverb === 1)).toBe(true);
        expect(old.mixer).toBeUndefined();
        expect(newEmptyProject().mixer!.master.limiter).toBe(true);
    });

    it('round-trips groups, sends, processors and master settings through import', () => {
        const p = newEmptyProject();
        const mixer = p.mixer!;
        const group = addMixerBus(mixer)!;
        const echo = addMixerBus(mixer, 'delay')!;
        group.name = 'Rhythm';
        group.compressor = {enabled: true, threshold: -14, ratio: 2};
        const channel = mixer.channels[p.instruments[0].id];
        channel.output = group.id;
        channel.sends.push({busId: echo.id, level: 0.2});
        mixer.master.driveDb = 3;
        expect(isMixerState(mixer)).toBe(true);
        expect(importProject(JSON.stringify(p))).toBe(true);
        let imported = null;
        const unsubscribe = project.subscribe(value => {
            imported = value;
        });
        unsubscribe();
        expect(imported).toEqual(p);
    });

    it('rejects output/send feedback, even through zero-level or muted routes', () => {
        const mixer = createMixer([createId()]);
        const a = addMixerBus(mixer)!;
        const b = addMixerBus(mixer)!;
        const c = addMixerBus(mixer, 'delay')!;
        a.output = b.id;
        b.sends.push({busId: c.id, level: 0});
        b.mute = true;
        expect(canRoute(mixer, c.id, a.id)).toBe(false);
        expect(canRoute(mixer, a.id, a.id)).toBe(false);
        expect(canRoute(mixer, b.id, a.id)).toBe(false);
        expect(canRoute(mixer, a.id, c.id)).toBe(true);
        expect(canRoute(mixer, a.id, 'missing')).toBe(false);
        expect(isMixerState(mixer)).toBe(true);
        c.output = a.id;
        expect(isMixerState(mixer)).toBe(false);
        const p = newEmptyProject();
        p.mixer = mixer;
        expect(importProject(JSON.stringify(p))).toBe(false);
    });

    it('rejects malformed, duplicate and unsafe mixer data', () => {
        const mixer = createMixer([createId()]);
        const bus = addMixerBus(mixer)!;
        const invalid = [
            {...mixer, master: {...mixer.master, driveDb: NaN}},
            {...mixer, master: {...mixer.master, ceilingDb: 4}},
            {...mixer, master: {...mixer.master, release: 0}},
            {...mixer, master: {...mixer.master, vol: Infinity}},
            {...mixer, channels: []},
            {...mixer, channels: {invalid: Object.values(mixer.channels)[0]}},
            {...mixer, buses: [bus, bus]},
            {...mixer, buses: [{...bus, feedback: 1}]},
            {...mixer, buses: [{...bus, delayTime: 0}]},
            {...mixer, buses: [{...bus, output: 'unknown'}]},
            {...mixer, buses: [{...bus, sends: [{busId: bus.id, level: 0.3}]}]},
            {...mixer, channels: {[bus.id]: Object.values(mixer.channels)[0]}}
        ];
        for (const candidate of invalid) {
            expect(isMixerState(candidate)).toBe(false);
        }
        const channel = Object.values(mixer.channels)[0];
        channel.sends = [{busId: bus.id, level: 0.2}, {busId: bus.id, level: 0.3}];
        expect(isMixerState(mixer)).toBe(false);
    });

    it('deleting a bus repairs all affected outputs and sends', () => {
        const id = createId(), mixer = createMixer([id]);
        const group = addMixerBus(mixer)!;
        const echo = addMixerBus(mixer, 'delay')!;
        mixer.channels[id].output = group.id;
        mixer.channels[id].sends = [{busId: echo.id, level: 0.2}];
        echo.output = group.id;
        removeMixerBus(mixer, group.id);
        expect(mixer.channels[id].output).toBe('master');
        expect(echo.output).toBe('master');
        removeMixerBus(mixer, echo.id);
        expect(mixer.channels[id].sends).toEqual([]);
        expect(isMixerState(mixer)).toBe(true);
    });

    it('bounds graph size and gives new instruments independent default strips', () => {
        const p = newEmptyProject(), mixer = p.mixer!;
        for (let i = 0; i < MAX_MIXER_BUSES; i++) {
            expect(addMixerBus(mixer)).not.toBeNull();
        }
        expect(addMixerBus(mixer)).toBeNull();
        const id = createId();
        const copy = {...p.instruments[0], id};
        p.instruments = [copy];
        const resolved = ensureMixer(p);
        expect(Object.keys(resolved.channels)).toEqual([id]);
        expect(resolved.channels[id].volume).toBe(1);
        expect(resolved.channels[id].sends).toEqual([]);
        expect(resolved.channels[id]).not.toBe(Object.values(mixer.channels)[0]);
        expect(isMixerState(resolved)).toBe(true);
    });

    it('solos groups in place, preserving contributors and returns but excluding unrelated sources', () => {
        const [kick, flute, violin] = [createId(), createId(), createId()];
        const mixer = createMixer([kick, flute, violin]);
        const group = addMixerBus(mixer)!;
        const parent = addMixerBus(mixer)!;
        const echo = addMixerBus(mixer, 'delay')!;
        mixer.channels[flute].output = group.id;
        mixer.channels[violin].output = group.id;
        group.output = parent.id;
        mixer.channels[flute].sends = [{busId: echo.id, level: 0.1}];
        group.solo = true;
        expect(audibleMixerIds(mixer)).toEqual(new Set([group.id, flute, violin, parent.id, echo.id]));
        group.solo = false;
        mixer.channels[flute].solo = true;
        expect(audibleMixerIds(mixer)).toEqual(new Set([flute, group.id, parent.id, echo.id]));
        mixer.channels[flute].mute = true;
        expect(audibleMixerIds(mixer)).toEqual(new Set());
    });

    it('group mute also cuts its contributors from the reverb/send feeds', () => {
        const id = createId(), mixer = createMixer([id]);
        const group = addMixerBus(mixer)!;
        const echo = addMixerBus(mixer, 'delay')!;
        mixer.channels[id].output = group.id;
        mixer.channels[id].sends = [{busId: echo.id, level: 0.2}];
        group.mute = true;
        expect(audibleMixerIds(mixer).has(id)).toBe(false);
        group.mute = false;
        echo.mute = true;
        expect(audibleMixerIds(mixer).has(id)).toBe(true);
        expect(audibleMixerIds(mixer).has(echo.id)).toBe(false);
    });

    it('preserves serial echo tails and ignores unused or zero-level returns', () => {
        const id = createId(), mixer = createMixer([id]);
        const a = addMixerBus(mixer, 'delay')!, b = addMixerBus(mixer, 'delay')!;
        a.delayTime = 2;
        a.feedback = 0.8;
        b.delayTime = 0.5;
        b.feedback = 0;
        expect(mixerTailSeconds(mixer)).toBe(0);
        mixer.channels[id].sends = [{busId: a.id, level: 0}];
        expect(mixerTailSeconds(mixer)).toBe(0);
        mixer.channels[id].sends[0].level = 0.1;
        const first = mixerTailSeconds(mixer);
        expect(first).toBeGreaterThan(60);
        a.output = b.id;
        expect(mixerTailSeconds(mixer)).toBe(first + 0.5);
        mixer.channels[id].mute = true;
        expect(mixerTailSeconds(mixer)).toBe(0);
    });
});
