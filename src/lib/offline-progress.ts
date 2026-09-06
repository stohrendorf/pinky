export interface WorkProgressOptions {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
}

interface OfflineProgressOptions {
    signal?: AbortSignal;
    onProgress?: (progress: number | null) => void;
    subscribeFrames?: (listener: (frames: number) => void) => () => void;
}

export function supportsOfflineSuspension(context: OfflineAudioContext): boolean {
    return typeof context.suspend === 'function' && typeof context.resume === 'function';
}

export function checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) {throw new DOMException('Export cancelled', 'AbortError');}
}

// Yield to input/paint, not just the microtask queue. Time never drives progress.
export async function yieldExport(signal?: AbortSignal): Promise<void> {
    checkAbort(signal);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    checkAbort(signal);
}

// Only use for work that cannot mutate the swapped engine after it settles.
export async function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {return work;}
    let cancel = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new DOMException('Export cancelled', 'AbortError'));
        signal.addEventListener('abort', cancel, {once: true});
        if (signal.aborted) {cancel();}
    });
    try {return await Promise.race([work, aborted]);}
    finally {signal.removeEventListener('abort', cancel);}
}

/** OfflineAudioContext has no close/cancel primitive. Stop at an actual render
 * quantum and abandon the suspended context; never resume it after an abort.
 * Without suspend/resume support, wait for completion and discard on abort.
 * The caller may release its graph only once this function settles. */
export async function renderWithProgress(context: OfflineAudioContext, options: OfflineProgressOptions): Promise<AudioBuffer> {
    const {signal, onProgress} = options;
    checkAbort(signal);
    // Legacy callers need neither checkpoints nor event-loop yields.
    if (!signal && !onProgress) {return context.startRendering();}
    if (!supportsOfflineSuspension(context)) {
        // Firefox cannot suspend offline contexts, but the output worklet can
        // report completed frames. Retain ownership until native work finishes.
        onProgress?.(null);
        checkAbort(signal);
        let active = true, last = 0, observerFailed = false;
        let observerError: unknown;
        const unsubscribe = onProgress ? options.subscribeFrames?.(frames => {
            if (!active || signal?.aborted || observerFailed || !Number.isFinite(frames) || frames <= last) {return;}
            // The final quantum can extend beyond length. Only native
            // completion, not a queued port message, is allowed to report 100%.
            const completed = Math.min(context.length - 1, frames);
            if (completed <= last) {return;}
            last = completed;
            try {onProgress(last / context.length);}
            catch (error) {observerFailed = true; observerError = error;}
        }) : undefined;
        try {
            const buffer = await context.startRendering();
            checkAbort(signal);
            if (observerFailed) {throw observerError;}
            onProgress?.(1);
            checkAbort(signal);
            return buffer;
        } finally {
            active = false;
            unsubscribe?.();
        }
    }
    const interval = Math.ceil(context.sampleRate * 0.25 / 128) * 128;
    let frame = 0;
    let checkpoint = context.suspend(0).then(() => ({kind: 'paused' as const}));
    // Always consume the native promise, including a late rejection after we
    // abandon a suspension. A pending native promise is NOT a cancellation.
    const completed = context.startRendering().then(
        buffer => ({kind: 'done' as const, buffer}),
        error => ({kind: 'failed' as const, error: error as unknown})
    );
    try {
        while (true) {
            const result = await Promise.race([completed, checkpoint]);
            if (result.kind === 'failed') {throw result.error;}
            checkAbort(signal);
            if (result.kind === 'done') {
                onProgress?.(1);
                checkAbort(signal);
                return result.buffer;
            }
            onProgress?.(Math.min(1, context.currentTime * context.sampleRate / context.length));
            await yieldExport(signal);
            frame += interval;
            if (frame < context.length) {
                checkpoint = context.suspend(frame / context.sampleRate).then(() => ({kind: 'paused' as const}));
            } else {
                checkpoint = new Promise<never>(() => {});
            }
            await context.resume();
        }
    } finally {
        // Normally errors/abort arrive while suspended or after completion.
        // If a native suspension/resume fails while running, do not release a
        // swapped engine while audio work still owns it.
        if (context.state === 'running') {await completed;}
    }
}
