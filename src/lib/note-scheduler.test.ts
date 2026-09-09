import { describe, expect, it, vi } from 'vitest';

import type { ManagedVoice } from './voice-collection';

import {
    NoteScheduler,
    type NoteSchedulingCollection,
    type NoteSchedulingParams,
} from './note-scheduler';

interface TestParams extends NoteSchedulingParams {
    label: string;
}

function voice(cost = 3): ManagedVoice<TestParams> {
    return {
        cost,
        stopAt: Infinity,
        dead: false,
        loudness: () => 1,
        stop: vi.fn(),
        glide: vi.fn(),
        setParams: vi.fn(),
    };
}

function scheduler(now: number | null = 2) {
    let load = 0;
    const loadWrites: number[] = [];
    const voices: NoteSchedulingCollection<TestParams> = {
        get load() {
            return load;
        },
        set load(value: number) {
            load = value;
            loadWrites.push(value);
        },
        glide: vi.fn(() => true),
        replaceActive: vi.fn(),
        prepare: vi.fn(() => 7),
        register: vi.fn(),
        noteOff: vi.fn(),
        automate: vi.fn(),
        allNotesOff: vi.fn(),
    };
    const created = voice();
    const createVoice = vi.fn(() => created);
    const findNote = vi.fn(name =>
        name === 'C4' ? { freq: 261.63 } : name === 'D4' ? { freq: 293.66 } : undefined,
    );
    const instance = new NoteScheduler<TestParams>({
        findNote,
        currentTime: () => now,
        voices,
        createVoice,
        releaseTail: 1.5,
    });
    return { instance, voices, createVoice, created, loadWrites, findNote };
}

const params: TestParams = { rel: 2, label: 'test' };

describe('NoteScheduler', () => {
    it('creates a voice through injected collaborators and clamps its start time', () => {
        const { instance, voices, createVoice, created, loadWrites } = scheduler(2);

        instance.noteOnAt('lead', 'C4', 1, params, 0.75);

        expect(voices.replaceActive).toHaveBeenCalledWith('lead:C4', 2);
        expect(voices.prepare).toHaveBeenCalledWith(2);
        expect(loadWrites).toEqual([7, 10]);
        expect(createVoice).toHaveBeenCalledWith('lead', 261.63, 2, params, 0.75);
        expect(voices.register).toHaveBeenCalledWith('lead', 'lead:C4', 2, created, 3.1);
    });

    it('glides the explicitly named source voice', () => {
        const { instance, voices } = scheduler(2);

        expect(instance.glideAt('lead', 'C4', 'D4', 3, 0.2)).toBe(true);

        expect(voices.glide).toHaveBeenCalledWith(
            'lead',
            'lead:C4',
            'lead:D4',
            3,
            293.66,
            0.2,
            'linear',
        );
    });

    it('delegates absolute and relative release commands with the current-time guard', () => {
        const { instance, voices } = scheduler(2);

        instance.noteOffAt('lead', 'C4', 1);
        instance.noteOff('lead', 'C4', 0.5);
        instance.allNotesOff();
        instance.automateInstrument('lead', params, 4, 0.1);

        expect(voices.noteOff).toHaveBeenNthCalledWith(1, 'lead:C4', 2);
        expect(voices.noteOff).toHaveBeenNthCalledWith(2, 'lead:C4', 2.5);
        expect(voices.allNotesOff).toHaveBeenCalledWith(2);
        expect(voices.automate).toHaveBeenCalledWith('lead', params, 4, 0.1);
    });

    it('does nothing for unknown notes or when audio is unavailable', () => {
        const unknown = scheduler(2);
        unknown.instance.noteOnAt('lead', 'H9', 0, params);
        expect(unknown.findNote).toHaveBeenCalledWith('H9');
        expect(unknown.createVoice).not.toHaveBeenCalled();

        const { instance, voices, createVoice } = scheduler(null);

        instance.noteOnAt('lead', 'C4', 0, params);
        instance.noteOffAt('lead', 'C4', 0);
        instance.allNotesOff();
        instance.automateInstrument('lead', params, 0, 0.1);
        expect(instance.glideAt('lead', 'C4', 'D4', 0, 0.1)).toBe(false);

        expect(createVoice).not.toHaveBeenCalled();
        expect(voices.replaceActive).not.toHaveBeenCalled();
        expect(voices.noteOff).not.toHaveBeenCalled();
        expect(voices.allNotesOff).not.toHaveBeenCalled();
        expect(voices.automate).not.toHaveBeenCalled();
    });
});
