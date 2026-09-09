import {
    afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';

import {
    renderWithProgress
} from './offline-progress';

// Lifecycle-only double: tests explicitly advance audio time, independently
// of wall-clock timers. Native DSP and suspension need browser validation.
class OfflineContext {
    sampleRate = 48000;
    length = 48000;
    currentTime = 0;
    state = 'suspended';
    finish!: (buffer: AudioBuffer) => void;
    fail!: (error: Error) => void;
    startRendering = vi.fn(() => {
        this.state = 'running';
        return new Promise<AudioBuffer>((resolve, reject) => {
            this.finish = buffer => {
                this.state = 'closed';
                resolve(buffer);
            };
            this.fail = error => {
                this.state = 'closed';
                reject(error);
            };
        });
    });
    resume = vi.fn(() => {
        this.state = 'running';
        return Promise.resolve();
    });

    pause = () => {
    };

    suspend = vi.fn((at: number) => new Promise<void>(resolve => {
        this.pause = () => {
            this.currentTime = at;
            this.state = 'suspended';
            resolve();
        };
    }));

    native() {
        return this as unknown as OfflineAudioContext;
    }
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('offline render checkpoints', () => {
    it('uses worklet frame progress without interrupting a render that supports suspension', async () => {
        const context = new OfflineContext();
        const progress: number[] = [];
        let frames!: (value: number) => void;
        const unsubscribe = vi.fn();

        const pending = renderWithProgress(context.native(), {
            onProgress: value => {
                if (value !== null) {
                    progress.push(value);
                }
            },
            subscribeFrames: listener => {
                frames = listener;
                return unsubscribe;
            }
        });

        expect(context.startRendering).toHaveBeenCalledOnce();
        expect(context.suspend).not.toHaveBeenCalled();
        frames(12000);
        expect(progress).toEqual([0.25]);
        context.finish({} as AudioBuffer);
        await pending;
        expect(progress).toEqual([0.25, 1]);
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('reports only actual rendered time, monotonically, with no timer interpolation', async () => {
        const context = new OfflineContext();
        const progress: (number | null)[] = [];
        const pending = renderWithProgress(context.native(), {onProgress: value => progress.push(value)});
        await vi.advanceTimersByTimeAsync(10000);
        expect(progress).toEqual([]);
        context.pause();
        await vi.advanceTimersByTimeAsync(1);
        expect(progress).toEqual([0]);
        expect(context.resume).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(10000);
        expect(progress).toEqual([0]);
        context.pause();
        await vi.advanceTimersByTimeAsync(1);
        expect(progress).toEqual([0, 12032 / 48000]);
        context.pause();
        await vi.advanceTimersByTimeAsync(1);
        expect(progress).toEqual([0, 12032 / 48000, 24064 / 48000]);
        context.finish({} as AudioBuffer);
        await pending;
        expect(progress.at(-1)).toBe(1);
    });

    it('awaits suspension when abort races active rendering, never resumes, and consumes a late native rejection', async () => {
        const context = new OfflineContext();
        const controller = new AbortController();
        let settled = false;
        const pending = renderWithProgress(context.native(), {signal: controller.signal});
        const result = pending.catch(error => {
            settled = true;
            return error as Error;
        });
        context.pause();
        await vi.advanceTimersByTimeAsync(1);
        expect(context.state).toBe('running');
        controller.abort();
        await vi.advanceTimersByTimeAsync(1000);
        expect(settled).toBe(false);
        context.pause();
        expect(await result).toMatchObject({name: 'AbortError'});
        expect(context.state).toBe('suspended');
        expect(context.resume).toHaveBeenCalledOnce();
        context.fail(new Error('late native rejection'));
        await vi.advanceTimersByTimeAsync(1);
    });

    it('aborts before starting and at a suspended callback', async () => {
        const controller = new AbortController();
        controller.abort();
        const early = new OfflineContext();
        await expect(renderWithProgress(early.native(), {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(early.startRendering).not.toHaveBeenCalled();
        const context = new OfflineContext();
        const next = new AbortController();
        const pending = renderWithProgress(context.native(), {signal: next.signal, onProgress: () => next.abort()});
        const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        context.pause();
        await rejected;
        expect(context.resume).not.toHaveBeenCalled();
    });

    it('propagates rendering and observer errors without resuming a suspended graph', async () => {
        const context = new OfflineContext();
        const pending = renderWithProgress(context.native(), {
            onProgress: () => {
                throw new Error('observer failed');
            }
        });
        const rejected = expect(pending).rejects.toThrow('observer failed');
        context.pause();
        await rejected;
        expect(context.resume).not.toHaveBeenCalled();
        const retry = new OfflineContext();
        const failed = renderWithProgress(retry.native(), {signal: new AbortController().signal});
        const nativeFailure = expect(failed).rejects.toThrow('render failed');
        retry.fail(new Error('render failed'));
        await nativeFailure;
    });
});

describe('offline rendering without suspension support', () => {
    function without(method: 'suspend' | 'resume') {
        const context = new OfflineContext();
        Object.defineProperty(context, method, {value: undefined});
        return context;
    }

    it('reports actual worklet frames, ignores invalid/late updates and never infers progress from elapsed time', async () => {
        const context = without('suspend');
        let frames!: (value: number) => void;
        const unsubscribe = vi.fn();
        const progress: (number | null)[] = [];
        const pending = renderWithProgress(context.native(), {
            onProgress: value => progress.push(value),
            subscribeFrames: listener => {
                frames = listener;
                return unsubscribe;
            }
        });
        expect(progress).toEqual([null]);
        frames(12000);
        frames(12000);
        frames(1000);
        frames(NaN);
        frames(Infinity);
        frames(-1);
        await vi.advanceTimersByTimeAsync(10000);
        expect(progress).toEqual([null, 0.25]);
        frames(36000);
        frames(48128);
        expect(progress).toEqual([null, 0.25, 0.75, 47999 / 48000]);
        context.finish({} as AudioBuffer);
        await pending;
        expect(progress.at(-1)).toBe(1);
        expect(unsubscribe).toHaveBeenCalledOnce();
        frames(24000);
        expect(progress.at(-1)).toBe(1);
    });

    it('contains asynchronous observer errors and retains native ownership until completion', async () => {
        const context = without('resume');
        let frames!: (value: number) => void;
        const unsubscribe = vi.fn();
        let settled = false;
        const pending = renderWithProgress(context.native(), {
            onProgress: value => {
                if (value !== null) {
                    throw new Error('observer failed');
                }
            },
            subscribeFrames: listener => {
                frames = listener;
                return unsubscribe;
            }
        });
        const result = pending.catch(error => {
            settled = true;
            return error as Error;
        });
        expect(() => frames(24000)).not.toThrow();
        await vi.advanceTimersByTimeAsync(1000);
        expect(settled).toBe(false);
        context.finish({} as AudioBuffer);
        expect(await result).toMatchObject({message: 'observer failed'});
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('suppresses frame callbacks after cancellation while waiting for native completion', async () => {
        const context = without('suspend');
        const controller = new AbortController();
        let frames!: (value: number) => void;
        const unsubscribe = vi.fn(), progress = vi.fn();
        const pending = renderWithProgress(context.native(), {
            signal: controller.signal, onProgress: progress,
            subscribeFrames: listener => {
                frames = listener;
                return unsubscribe;
            }
        });
        const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        frames(12000);
        controller.abort();
        frames(24000);
        context.finish({} as AudioBuffer);
        await rejected;
        expect(progress.mock.calls).toEqual([[null], [0.25]]);
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it.each(['suspend', 'resume'] as const)('exports without %s and reports indeterminate progress until completion', async method => {
        const context = without(method);
        const progress: (number | null)[] = [];
        const pending = renderWithProgress(context.native(), {onProgress: value => progress.push(value)});
        const resolved = expect(pending).resolves.toEqual({length: 48000});
        await vi.advanceTimersByTimeAsync(10000);
        expect(progress).toEqual([null]);
        expect(context.startRendering).toHaveBeenCalledOnce();
        context.finish({length: 48000} as AudioBuffer);
        await resolved;
        expect(progress).toEqual([null, 1]);
    });

    it('acknowledges cancellation immediately and defers native cleanup to its owner', async () => {
        const context = without('suspend');
        const controller = new AbortController();
        const progress = vi.fn();
        let complete!: Promise<void>;
        const pending = renderWithProgress(context.native(), {
            signal: controller.signal, onProgress: progress, onAbandon: completion => {
                complete = completion;
            }
        });
        controller.abort();
        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(context.state).toBe('running');
        let settled = false;
        void complete.then(() => {
            settled = true;
        });
        await vi.advanceTimersByTimeAsync(10000);
        expect(settled).toBe(false);
        context.finish({} as AudioBuffer);
        await complete;
        expect(progress.mock.calls).toEqual([[null]]);
        expect(context.resume).not.toHaveBeenCalled();
    });

    it('does not start rendering if cancelled by the initial progress callback', async () => {
        const context = without('suspend');
        const controller = new AbortController();
        await expect(renderWithProgress(context.native(), {
            signal: controller.signal, onProgress: () => controller.abort()
        })).rejects.toMatchObject({name: 'AbortError'});
        expect(context.startRendering).not.toHaveBeenCalled();
    });

    it('propagates native failure and allows a fresh render', async () => {
        const context = without('suspend');
        const failed = expect(renderWithProgress(context.native(), {onProgress: vi.fn()})).rejects.toThrow('native failure');
        context.fail(new Error('native failure'));
        await failed;
        const retry = without('suspend');
        const pending = renderWithProgress(retry.native(), {signal: new AbortController().signal});
        retry.finish({} as AudioBuffer);
        await expect(pending).resolves.toEqual({});
    });

    it('still honours cancellation at the completion callback', async () => {
        const context = without('suspend');
        const controller = new AbortController();
        const pending = renderWithProgress(context.native(), {
            signal: controller.signal, onProgress: progress => {
                if (progress === 1) {
                    controller.abort();
                }
            }
        });
        const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        context.finish({} as AudioBuffer);
        await rejected;
    });
});
