import {
    get
} from 'svelte/store';
import {
    afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';

import type {
    Project
} from './types';

import {
    mixerTarget
} from './automation';
import * as engine from './engine';
import {
    createMixer
} from './mixer';
import {
    newEmptyProject, playing, project, selPatId, songCursor
} from './project';
import {
    createTimingMap, ensureConductor
} from './timing';
import {
    playPattern, playSong, scheduleRange, scheduleRangeAsync, seekSong, stopTransport
} from './transport';
import {
    createId
} from './types';

const clock = vi.hoisted(() => ({now: 0, tick: null as null | ((time: number) => void)}));
vi.mock('./engine', () => ({
    configureMixer: vi.fn(), noteOnAt: vi.fn(), noteOffAt: vi.fn(), glideAt: vi.fn(),
    automateMaster: vi.fn(), automateInstrument: vi.fn(), automateMixer: vi.fn(), allNotesOff: vi.fn(),
    resetMaster: vi.fn(), resetMixer: vi.fn(),
    isRendering: () => false, ensureAudio: vi.fn(async () => {}), outputLatency: () => 0.005,
    audioTime: () => clock.now, clockStart: vi.fn(), clockStop: vi.fn(),
    setTickHandler: (callback: (time: number) => void) => {clock.tick = callback;}
}));

function score(): Project {
    const p = newEmptyProject(), id = p.instruments[0].id;
    p.bpm = 120;
    p.patterns[0].steps = 32;
    p.arrangement[0].len = 32;
    p.patterns[0].tracks[id] = [
        {pitch: 'C5', start: 0, len: 12},
        {pitch: 'D5', start: 8, len: 4},
        {pitch: 'E5', start: 16, len: 2},
        {pitch: 'F5', start: 24, len: 4}
    ];
    const conductor = ensureConductor(p);
    conductor.tempos = [
        {id: createId(), step: 0, bpm: 120, curve: 'hold'},
        {id: createId(), step: 8, bpm: 60, curve: 'linear'},
        {id: createId(), step: 24, bpm: 120, curve: 'hold'}
    ];
    p.automation = [{id: createId(), target: 'master', param: 'vol', points: [{step: 0, value: 0.5}, {step: 32, value: 0.8}]}];
    p.mixer = createMixer([id]);
    p.automation.push({
        id: createId(), target: mixerTarget('channel', id), param: 'pan',
        points: [{step: 0, value: -0.5}, {step: 32, value: 0.5}]
    });
    return p;
}

beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    stopTransport();
    vi.clearAllMocks();
    clock.now = 0;
    songCursor.set(0);
});
afterEach(() => {stopTransport(); vi.unstubAllGlobals();});

describe('conductor-aware scheduling', () => {
    it('maps note starts, releases across markers and automation through the same ramp integral', () => {
        const p = score(), timing = createTimingMap(p), id = p.instruments[0].id;
        expect(scheduleRange(p, 0, 32)).toBeCloseTo(timing.secondsAt(32), 10);
        const on = vi.mocked(engine.noteOnAt).mock.calls;
        expect(on.map(call => call[1])).toEqual(['C5', 'D5', 'E5', 'F5']);
        for (let i = 0; i < on.length; i++) {expect(on[i][2]).toBeCloseTo(timing.secondsAt(i * 8), 10);}
        expect(engine.noteOffAt).toHaveBeenCalledWith(id, 'C5', timing.secondsAt(10.8));
        const automation = vi.mocked(engine.automateMaster).mock.calls[8];
        expect(automation[2]).toBe(1);
        expect(automation[3]).toBeCloseTo(timing.secondsBetween(8, 9) / 3, 10);
        expect(engine.automateMixer).toHaveBeenCalledWith(id, 'pan', -0.25, 1, automation[3]);
    });

    it('maps both ends of slides, including a terminal linked note after a tempo change', () => {
        const p = score(), id = p.instruments[0].id, timing = createTimingMap(p);
        p.patterns[0].tracks[id] = [
            {pitch: 'C5', start: 4, len: 2, legatoTo: {pitch: 'D5', start: 12, curve: 'smooth'}},
            {pitch: 'D5', start: 12, len: 8}
        ];
        scheduleRange(p, 0, 32);
        expect(engine.noteOnAt).toHaveBeenCalledOnce();
        const glide = vi.mocked(engine.glideAt).mock.calls[0];
        expect(glide.slice(0, 3)).toEqual([id, 'C5', 'D5']);
        expect(glide[3]).toBeCloseTo(timing.secondsAt(6), 10);
        expect(glide[4]).toBeCloseTo(timing.secondsBetween(6, 12), 10);
        expect(glide[5]).toBe('smooth');
        expect(engine.noteOffAt).toHaveBeenCalledWith(id, 'D5', timing.secondsAt(20));
    });

    it('uses absolute musical positions for a selected export and fractional swing within ramps', () => {
        const p = score(), id = p.instruments[0].id, timing = createTimingMap(p);
        p.swing = 0.6;
        p.patterns[0].tracks[id] = [{pitch: 'D5', start: 9, len: 4}];
        const seconds = scheduleRange(p, 8, 16);
        expect(seconds).toBeCloseTo(timing.secondsBetween(8, 16), 10);
        expect(vi.mocked(engine.noteOnAt).mock.calls[0][2]).toBeCloseTo(timing.secondsBetween(8, 9.2), 10);
        expect(vi.mocked(engine.noteOffAt).mock.calls[0][2]).toBeCloseTo(timing.secondsBetween(8, 12.8), 10);
    });

    it('plays the same timestamps live and offline, and seeks into the current ramp', async () => {
        const p = score(), timing = createTimingMap(p);
        scheduleRange(p, 0, 32);
        const offline = vi.mocked(engine.noteOnAt).mock.calls.map(call => [call[1], call[2]] as const);
        vi.clearAllMocks();
        project.set(p);
        await playSong();
        for (let t = 0; t < timing.secondsAt(32); t += 0.02) {clock.now = t; clock.tick!(t);}
        const live = vi.mocked(engine.noteOnAt).mock.calls;
        expect(live).toHaveLength(offline.length);
        live.forEach((call, i) => {expect(call[1]).toBe(offline[i][0]); expect(call[2] - 0.06).toBeCloseTo(offline[i][1], 9);});
        vi.clearAllMocks();
        clock.now = 10;
        seekSong(16);
        clock.tick!(10);
        expect(vi.mocked(engine.noteOnAt).mock.calls[0][1]).toBe('E5');
        expect(vi.mocked(engine.noteOnAt).mock.calls[0][2]).toBeCloseTo(10.02, 10);
    });

    it('loops with the integrated duration and leaves pattern preview on the base tempo', async () => {
        const p = score(), timing = createTimingMap(p);
        p.loop = {start: 8, end: 16};
        project.set(p);
        await playSong();
        const loopSeconds = timing.secondsBetween(8, 16);
        for (let t = 0; t < loopSeconds + 0.15; t += 0.02) {clock.now = t; clock.tick!(t);}
        const on = vi.mocked(engine.noteOnAt).mock.calls;
        expect(on).toHaveLength(2);
        expect(on.map(call => call[1])).toEqual(['D5', 'D5']);
        expect(on[1][2] - on[0][2]).toBeCloseTo(loopSeconds, 9);
        stopTransport(); vi.clearAllMocks(); clock.now = 0;
        selPatId.set(p.patterns[0].id);
        await playPattern();
        for (let t = 0; t < 2.1; t += 0.02) {clock.now = t; clock.tick!(t);}
        const notes = vi.mocked(engine.noteOnAt).mock.calls;
        expect(notes[2][2] - notes[0][2]).toBeCloseTo(2, 10);
        expect(get(playing)).toBe(true);
    });

    it('schedules asynchronous batches identically and aborts before allocating more notes', async () => {
        const p = score();
        p.arrangement[0].len = 96;
        scheduleRange(p, 0, 96);
        const expected = vi.mocked(engine.noteOnAt).mock.calls.map(call => [...call]);
        vi.clearAllMocks();
        const updates: number[] = [];
        await scheduleRangeAsync(p, 0, 96, {onProgress: value => updates.push(value)});
        expect(vi.mocked(engine.noteOnAt).mock.calls).toEqual(expected);
        expect(updates).toEqual([0, 1 / 3, 2 / 3, 1]);
        vi.clearAllMocks();
        const controller = new AbortController();
        await expect(scheduleRangeAsync(p, 0, 96, {signal: controller.signal, onProgress: value => {
            if (value >= 1 / 3) {controller.abort();}
        }})).rejects.toMatchObject({name: 'AbortError'});
        expect(engine.noteOnAt).toHaveBeenCalledTimes(4);
        vi.clearAllMocks();
        await expect(scheduleRangeAsync(p, 0, 96, {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(engine.configureMixer).not.toHaveBeenCalled();
    });
});
