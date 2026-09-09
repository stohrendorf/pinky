import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportProgressState } from './render';

import { addMixerBus, mixerTailSeconds } from './mixer';
import { newEmptyProject, playing, project } from './project';
import {
    cancelExport,
    dismissExportError,
    exportProgress,
    exportWav,
    rendering,
    renderSongToWav,
} from './render';
import { createTimingMap } from './timing';

const audio = vi.hoisted(() => ({ renderOffline: vi.fn(), isRendering: vi.fn(() => false) }));
const transport = vi.hoisted(() => ({
    scheduleRangeAsync: vi.fn(),
    songLengthSteps: vi.fn(() => 32),
    stopTransport: vi.fn(),
}));
const wav = vi.hoisted(() => ({ encodeWavAsync: vi.fn() }));
vi.mock('./engine', () => audio);
vi.mock('./transport', () => transport);
vi.mock('./wav', () => wav);

beforeEach(() => {
    vi.clearAllMocks();
    rendering.set(false);
    dismissExportError();
    playing.set(false);
    audio.isRendering.mockReturnValue(false);
    transport.scheduleRangeAsync.mockResolvedValue(0);
    wav.encodeWavAsync.mockResolvedValue(new Blob(['wav']));
    audio.renderOffline.mockImplementation(
        async (_seconds: number, _rate: number, schedule: () => Promise<number>) => {
            await schedule();
            return {};
        },
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('mixer WAV export integration', () => {
    it('renders loop boundaries with release, room and delay tails and an explicit mix snapshot', async () => {
        const p = newEmptyProject();
        p.loop = { start: 4, end: 12 };
        const echo = addMixerBus(p.mixer!, 'delay')!;
        echo.delayTime = 0.5;
        echo.feedback = 0.5;
        p.mixer!.channels[p.instruments[0].id].sends = [{ busId: echo.id, level: 0.2 }];
        p.mixer!.master.vol = 0.37;
        project.set(p);
        playing.set(true);
        expect(await renderSongToWav()).toBeInstanceOf(Blob);
        const seconds =
            (8 * 60) / p.bpm / 4 +
            p.instruments[0].params.rel * 1.5 +
            3 +
            mixerTailSeconds(p.mixer);
        expect(audio.renderOffline).toHaveBeenCalledWith(
            seconds,
            44100,
            expect.any(Function),
            {
                mixer: p.mixer,
                instrumentIds: [p.instruments[0].id],
                master: p.mixer!.master,
            },
            { signal: expect.any(AbortSignal), onProgress: expect.any(Function) },
        );
        expect(transport.scheduleRangeAsync).toHaveBeenCalledWith(p, 4, 12, {
            signal: expect.any(AbortSignal),
            onProgress: expect.any(Function),
        });
        expect(transport.stopTransport).toHaveBeenCalledOnce();
        expect(get(rendering)).toBe(false);
    });

    it('isolates score and mixer edits after export begins and rejects overlapping exports', async () => {
        const p = newEmptyProject();
        project.set(p);
        let finish!: () => void, schedule!: () => void;
        audio.renderOffline.mockImplementation(
            (_seconds: number, _rate: number, callback: () => void) => {
                schedule = callback;
                return new Promise(resolve => {
                    finish = () => resolve({});
                });
            },
        );
        const pending = renderSongToWav();
        expect(get(rendering)).toBe(true);
        await vi.waitFor(() => expect(audio.renderOffline).toHaveBeenCalled());
        p.mixer!.master.vol = 0.1;
        p.patterns[0].steps = 128;
        await expect(renderSongToWav()).rejects.toThrow('already in progress');
        schedule();
        const snapshot = transport.scheduleRangeAsync.mock.calls[0][0] as typeof p;
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

    it('uses the conductor timing map for loop duration', async () => {
        const p = newEmptyProject();
        p.loop = { start: 4, end: 24 };
        p.conductor = {
            tempos: [
                { id: 'ramp', step: 0, bpm: 60, curve: 'linear' },
                { id: 'fast', step: 16, bpm: 180, curve: 'hold' },
            ],
            meters: [],
            sections: [],
        };
        project.set(p);
        await renderSongToWav();
        expect(audio.renderOffline.mock.calls[0][0]).toBeCloseTo(
            createTimingMap(p).secondsBetween(4, 24) +
                p.instruments[0].params.rel * 1.5 +
                3 +
                mixerTailSeconds(p.mixer),
        );
        expect(audio.renderOffline.mock.calls[0][0]).not.toBeCloseTo(
            (20 * 60) / p.bpm / 4 +
                p.instruments[0].params.rel * 1.5 +
                3 +
                mixerTailSeconds(p.mixer),
        );
    });

    it('cancels before graph preparation without scheduling or downloading', async () => {
        project.set(newEmptyProject());
        const download = vi.fn();
        vi.stubGlobal('document', { createElement: download });
        const pending = exportWav();
        cancelExport();
        expect(get(exportProgress)?.cancelling).toBe(true);
        expect(get(rendering)).toBe(true);
        expect(await pending).toBe('');
        expect(audio.renderOffline).not.toHaveBeenCalled();
        expect(wav.encodeWavAsync).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
        expect(get(exportProgress)).toBeNull();
        expect(get(rendering)).toBe(false);
    });

    it('retains the render guard until the engine acknowledges cancellation', async () => {
        project.set(newEmptyProject());
        let finish!: () => void;
        audio.renderOffline.mockImplementation(
            () =>
                new Promise(resolve => {
                    finish = () => resolve({});
                }),
        );
        const pending = renderSongToWav();
        const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await vi.waitFor(() => expect(audio.renderOffline).toHaveBeenCalled());
        cancelExport();
        expect(get(rendering)).toBe(true);
        await expect(renderSongToWav()).rejects.toThrow('already in progress');
        finish();
        await cancelled;
        expect(wav.encodeWavAsync).not.toHaveBeenCalled();
        expect(get(rendering)).toBe(false);
    });

    it('passes cancellation through scheduling and does not encode', async () => {
        project.set(newEmptyProject());
        transport.scheduleRangeAsync.mockImplementation(
            (_p, _from, _to, options: { signal: AbortSignal }) => {
                cancelExport();
                expect(options.signal.aborted).toBe(true);
                return Promise.reject(new DOMException('cancelled', 'AbortError'));
            },
        );
        expect(await exportWav()).toBe('');
        expect(wav.encodeWavAsync).not.toHaveBeenCalled();
        expect(get(rendering)).toBe(false);
    });

    it('clears a non-suspendable cancellation as soon as the engine releases its graph', async () => {
        project.set(newEmptyProject());
        const download = vi.fn();
        vi.stubGlobal('document', { createElement: download });
        let time = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => time);
        let finish!: () => void;
        let lateProgress!: () => void;
        audio.renderOffline.mockImplementation(
            (
                _seconds,
                _rate,
                _schedule,
                _config,
                options: {
                    signal: AbortSignal;
                    onProgress: (value: {
                        stage: string;
                        progress: number;
                        canSuspend: boolean;
                    }) => void;
                },
            ) => {
                options.onProgress({ stage: 'rendering', progress: 0, canSuspend: false });
                time += 1000;
                options.onProgress({ stage: 'rendering', progress: 0.45, canSuspend: false });
                lateProgress = () =>
                    options.onProgress({ stage: 'rendering', progress: 0.9, canSuspend: false });
                return new Promise((resolve, reject) => {
                    options.signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('cancelled', 'AbortError')),
                        { once: true },
                    );
                    finish = () => resolve({});
                });
            },
        );
        const pending = exportWav();
        await vi.waitFor(() => expect(audio.renderOffline).toHaveBeenCalled());
        const active = get(exportProgress);
        cancelExport();
        const cancelled = get(exportProgress);
        const locked = get(rendering);
        expect(lateProgress).toThrow('Export cancelled');
        expect(get(exportProgress)).toBe(cancelled);
        expect(await pending).toBe('');
        expect(active).toMatchObject({
            stage: 'rendering',
            progress: 0.45,
            canSuspend: false,
            cancelling: false,
        });
        expect(active?.etaSeconds).toBeGreaterThan(0);
        expect(cancelled).toMatchObject({
            stage: 'rendering',
            progress: 0.45,
            canSuspend: false,
            cancelling: true,
            etaSeconds: null,
        });
        expect(locked).toBe(true);
        expect(wav.encodeWavAsync).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
        expect(get(exportProgress)).toBeNull();
        expect(get(rendering)).toBe(false);
        finish();
    });

    it('suppresses a late encoder result after cancellation and allows immediate retry', async () => {
        project.set(newEmptyProject());
        const click = vi.fn();
        vi.stubGlobal('document', { createElement: () => ({ click }) });
        let finish!: (blob: Blob) => void;
        wav.encodeWavAsync.mockImplementationOnce(
            () =>
                new Promise<Blob>(resolve => {
                    finish = resolve;
                }),
        );
        const pending = exportWav();
        await vi.waitFor(() => expect(wav.encodeWavAsync).toHaveBeenCalled());
        expect(get(exportProgress)?.stage).toBe('encoding');
        cancelExport();
        finish(new Blob(['wav']));
        expect(await pending).toBe('');
        expect(click).not.toHaveBeenCalled();
        expect(get(rendering)).toBe(false);
        expect(await exportWav()).toBe('');
        expect(click).toHaveBeenCalledOnce();
        expect(get(exportProgress)).toBeNull();
    });

    it('observes external aborts and exposes errors for keyboard-triggered exports', async () => {
        project.set(newEmptyProject());
        const controller = new AbortController();
        controller.abort();
        await expect(renderSongToWav({ signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(audio.renderOffline).not.toHaveBeenCalled();
        audio.renderOffline.mockRejectedValueOnce(new Error('worklet failed'));
        expect(await exportWav()).toContain('worklet failed');
        expect(get(exportProgress)).toMatchObject({
            stage: 'error',
            error: 'Render failed: worklet failed',
        });
        expect(get(rendering)).toBe(false);
        dismissExportError();
        expect(get(exportProgress)).toBeNull();
        expect(await renderSongToWav()).toBeInstanceOf(Blob);
    });

    it('exposes actual stage fractions without synthesizing an overall percentage', async () => {
        project.set(newEmptyProject());
        const updates: [string, number | null][] = [];
        audio.renderOffline.mockImplementation(
            async (
                _seconds,
                _rate,
                schedule: () => Promise<number>,
                _config,
                options: {
                    onProgress: (value: { stage: string; progress: number | null }) => void;
                },
            ) => {
                options.onProgress({ stage: 'preparing', progress: null });
                options.onProgress({ stage: 'scheduling', progress: 0 });
                await schedule();
                options.onProgress({ stage: 'rendering', progress: 0 });
                options.onProgress({ stage: 'rendering', progress: 0.25 });
                options.onProgress({ stage: 'rendering', progress: 1 });
                return {};
            },
        );
        transport.scheduleRangeAsync.mockImplementation(
            (
                _p,
                _from,
                _to,
                options: {
                    onProgress: (progress: number) => void;
                },
            ) => {
                options.onProgress(0.5);
                options.onProgress(1);
                return Promise.resolve(0);
            },
        );
        wav.encodeWavAsync.mockImplementation(
            (_buf, options: { onProgress: (progress: number) => void }) => {
                options.onProgress(0.5);
                options.onProgress(1);
                return Promise.resolve(new Blob(['wav']));
            },
        );
        await renderSongToWav({ onProgress: state => updates.push([state.stage, state.progress]) });
        expect(updates).toEqual([
            ['preparing', null],
            ['preparing', null],
            ['scheduling', 0],
            ['scheduling', 0.5],
            ['scheduling', 1],
            ['rendering', 0],
            ['rendering', 0.25],
            ['rendering', 1],
            ['encoding', 0],
            ['encoding', 0.5],
            ['encoding', 1],
        ]);
    });

    it('reports stage-local estimates and starts fresh during encoding and a subsequent export', async () => {
        project.set(newEmptyProject());
        let time = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => time);
        audio.renderOffline.mockImplementation(
            async (
                _seconds,
                _rate,
                schedule: () => Promise<number>,
                _config,
                options: {
                    onProgress: (value: {
                        stage: string;
                        progress: number;
                        canSuspend: boolean;
                    }) => void;
                },
            ) => {
                await schedule();
                options.onProgress({ stage: 'rendering', progress: 0, canSuspend: false });
                time += 1000;
                options.onProgress({ stage: 'rendering', progress: 0.1, canSuspend: false });
                const reported = get(exportProgress);
                time += 60000;
                await Promise.resolve();
                expect(get(exportProgress)).toBe(reported);
                return {};
            },
        );
        wav.encodeWavAsync.mockImplementation(
            (_buf, options: { onProgress: (progress: number) => void }) => {
                time += 500;
                options.onProgress(0.25);
                time += 500;
                options.onProgress(0.5);
                options.onProgress(1);
                return Promise.resolve(new Blob(['wav']));
            },
        );
        for (let attempt = 0; attempt < 2; attempt++) {
            const updates: ExportProgressState[] = [];
            await renderSongToWav({ onProgress: state => updates.push(state) });
            expect(updates.map(state => state.stage)).toEqual([
                'preparing',
                'rendering',
                'rendering',
                'encoding',
                'encoding',
                'encoding',
                'encoding',
            ]);
            expect(updates.slice(0, 2).every(state => state.etaSeconds === null)).toBe(true);
            expect(updates[2].etaSeconds).toBeCloseTo(9);
            expect(updates[3]).toMatchObject({ progress: 0, etaSeconds: null });
            expect(updates[3].canSuspend).toBeUndefined();
            expect(updates[4]).toMatchObject({ progress: 0.25, etaSeconds: null });
            expect(updates[5].etaSeconds).toBeCloseTo(1);
            expect(updates[6]).toMatchObject({ progress: 1, etaSeconds: null });
            expect(get(exportProgress)).toBeNull();
        }
    });

    it.each(['rendering', 'encoding'])(
        'honors an abort inside the %s callback before encoding or download continues',
        async stage => {
            project.set(newEmptyProject());
            const download = vi.fn();
            vi.stubGlobal('document', { createElement: download });
            audio.renderOffline.mockImplementation(
                async (
                    _seconds,
                    _rate,
                    schedule: () => Promise<number>,
                    _config,
                    options: {
                        onProgress: (value: { stage: string; progress: number }) => void;
                    },
                ) => {
                    await schedule();
                    options.onProgress({ stage: 'rendering', progress: 0.5 });
                    return {};
                },
            );
            wav.encodeWavAsync.mockImplementation(
                (_buf, options: { onProgress: (progress: number) => void }) => {
                    options.onProgress(1);
                    return Promise.resolve(new Blob(['wav']));
                },
            );
            expect(
                await exportWav({
                    onProgress: state => {
                        if (state.stage === stage && state.progress !== 0) {
                            cancelExport();
                        }
                    },
                }),
            ).toBe('');
            if (stage === 'rendering') {
                expect(wav.encodeWavAsync).not.toHaveBeenCalled();
            } else {
                expect(wav.encodeWavAsync).toHaveBeenCalledOnce();
            }
            expect(download).not.toHaveBeenCalled();
            expect(get(exportProgress)).toBeNull();
            expect(get(rendering)).toBe(false);
        },
    );
});
