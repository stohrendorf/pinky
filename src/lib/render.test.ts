import {
    get
} from 'svelte/store';
import {
    beforeEach, describe, expect, it, vi
} from 'vitest';

import {
    addMixerBus, mixerTailSeconds
} from './mixer';
import {
    newEmptyProject, playing, project
} from './project';
import {
    rendering, renderSongToWav
} from './render';

const audio = vi.hoisted(() => ({renderOffline: vi.fn(), isRendering: vi.fn(() => false)}));
const transport = vi.hoisted(() => ({scheduleRange: vi.fn(), songLengthSteps: vi.fn(() => 32), stopTransport: vi.fn()}));
vi.mock('./engine', () => audio);
vi.mock('./transport', () => transport);
vi.mock('./wav', () => ({encodeWav: () => new Blob(['wav'])}));

beforeEach(() => {
    vi.clearAllMocks();
    rendering.set(false);
    playing.set(false);
    audio.isRendering.mockReturnValue(false);
    audio.renderOffline.mockImplementation((_seconds: number, _rate: number, schedule: () => void) => {
        schedule();
        return Promise.resolve({});
    });
});

describe('mixer WAV export integration', () => {
    it('renders loop boundaries with release, room and delay tails and an explicit mix snapshot', async () => {
        const p = newEmptyProject();
        p.loop = {start: 4, end: 12};
        const echo = addMixerBus(p.mixer!, 'delay')!;
        echo.delayTime = 0.5; echo.feedback = 0.5;
        p.mixer!.channels[p.instruments[0].id].sends = [{busId: echo.id, level: 0.2}];
        p.mixer!.master.vol = 0.37;
        project.set(p); playing.set(true);
        expect(await renderSongToWav()).toBeInstanceOf(Blob);
        const seconds = 8 * 60 / p.bpm / 4 + p.instruments[0].params.rel * 1.5 + 3 + mixerTailSeconds(p.mixer);
        expect(audio.renderOffline).toHaveBeenCalledWith(seconds, 44100, expect.any(Function), {
            mixer: p.mixer, instrumentIds: [p.instruments[0].id], master: p.mixer!.master
        });
        expect(transport.scheduleRange).toHaveBeenCalledWith(p, 4, 12);
        expect(transport.stopTransport).toHaveBeenCalledOnce();
        expect(get(rendering)).toBe(false);
    });

    it('isolates score and mixer edits after export begins and rejects overlapping exports', async () => {
        const p = newEmptyProject();
        project.set(p);
        let finish!: () => void, schedule!: () => void;
        audio.renderOffline.mockImplementation((_seconds: number, _rate: number, callback: () => void) => {
            schedule = callback;
            return new Promise(resolve => {finish = () => resolve({});});
        });
        const pending = renderSongToWav();
        expect(get(rendering)).toBe(true);
        p.mixer!.master.vol = 0.1;
        p.patterns[0].steps = 128;
        await expect(renderSongToWav()).rejects.toThrow('already in progress');
        schedule();
        const snapshot = transport.scheduleRange.mock.calls[0][0] as typeof p;
        expect(snapshot).not.toBe(p);
        expect(snapshot.mixer!.master.vol).toBe(0.8);
        expect(snapshot.patterns[0].steps).toBe(32);
        finish();
        await pending;
        expect(get(rendering)).toBe(false);
    });

    it('always unlocks editing after a failed bounce', async () => {
        project.set(newEmptyProject());
        audio.renderOffline.mockRejectedValue(new Error('worklet failed'));
        await expect(renderSongToWav()).rejects.toThrow('worklet failed');
        expect(get(rendering)).toBe(false);
    });
});
