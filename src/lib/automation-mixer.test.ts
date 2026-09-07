import {
    describe, expect, it
} from 'vitest';

import type {
    Project
} from './types';

import {
    autoParamDef, autoParams, automationCurrentValue, laneColor, laneTitle, mixerAutomation, mixerTarget, parseMixerTarget
} from './automation';
import {
    DEFAULT_PARAMS
} from './instruments';
import {
    createMixer
} from './mixer';

const project = (): Project => {
    const mixer = createMixer(['lead/one']);
    mixer.channels['lead/one'].volume = 0.42;
    mixer.channels['lead/one'].pan = -0.3;
    mixer.buses = [{
        ...mixer.channels['lead/one'], id: 'echo|bus', name: 'Echo', effect: 'delay', delayTime: 0.35, feedback: 0.6
    }];
    return {
        formatVersion: 1,
        mixer,
        instruments: [{id: 'lead/one', name: 'Keys/Lead', color: '#123456', params: {...DEFAULT_PARAMS}}],
        patterns: [], arrangement: [], tracks: [], bpm: 120,
        zoom: {seq: {width: 1, height: 1}, arr: {width: 1, height: 1}}
    };
};

describe('mixer automation targets', () => {
    it('round-trips collision-prone channel and bus ids without treating them as instruments', () => {
        for (const [kind, id] of [['channel', 'lead/one'], ['bus', 'echo|bus']] as const) {
            const target = mixerTarget(kind, id);
            expect(parseMixerTarget(target)).toEqual({kind, id});
            expect(target).not.toBe(id);
        }
        expect(parseMixerTarget('mixer|channel|%not-encoded')).toBeNull();
        expect(parseMixerTarget('lead/one')).toBeNull();
    });

    it('provides only useful continuous controls for channels and buses', () => {
        const channel = autoParams(mixerTarget('channel', 'lead/one')).map(def => def.param);
        const bus = autoParams(mixerTarget('bus', 'echo|bus')).map(def => def.param);
        expect(channel).toEqual(['volume', 'pan', 'reverb', 'highpass', 'tilt']);
        expect(bus).toEqual([...channel, 'delayTime', 'feedback']);
        expect([...channel, ...bus]).not.toContain('mute');
        expect([...channel, ...bus]).not.toContain('solo');
        expect([...channel, ...bus]).not.toContain('output');
    });

    it('resolves definitions, titles, colors, and current persisted values for every target kind', () => {
        const p = project();
        const channelLane = {id: 'c', target: mixerTarget('channel', 'lead/one'), param: 'volume', points: []};
        const busLane = {id: 'b', target: mixerTarget('bus', 'echo|bus'), param: 'delayTime', points: []};
        expect(autoParamDef(channelLane)?.label).toBe('Volume');
        expect(laneTitle(p, channelLane)).toBe('Keys/Lead channel · Volume');
        expect(laneColor(p, channelLane)).toBe('#123456');
        expect(automationCurrentValue(p, channelLane.target, channelLane.param)).toBe(0.42);
        expect(laneTitle(p, busLane)).toBe('Echo bus · Delay Time');
        expect(automationCurrentValue(p, busLane.target, busLane.param)).toBe(0.35);
        expect(automationCurrentValue(p, 'master', 'vol')).toBe(0.8);
        expect(automationCurrentValue(p, 'lead/one', 'pan')).toBe(0);
    });

    it('extracts clamped scheduling values and ignores removed or malformed targets', () => {
        const p = project();
        p.automation = [
            {id: 'volume', target: mixerTarget('channel', 'lead/one'), param: 'volume', points: [{step: 0, value: 4}]},
            {id: 'feedback', target: mixerTarget('bus', 'echo|bus'), param: 'feedback', points: [{step: 0, value: 0.55}]},
            {id: 'removed', target: mixerTarget('bus', 'gone'), param: 'volume', points: [{step: 0, value: 1}]},
            {id: 'bad', target: 'mixer|bus|%broken', param: 'volume', points: [{step: 0, value: 1}]}
        ];
        expect(mixerAutomation(p, 0)).toEqual([
            {target: {kind: 'channel', id: 'lead/one'}, param: 'volume', value: 2},
            {target: {kind: 'bus', id: 'echo|bus'}, param: 'feedback', value: 0.55}
        ]);
    });
});