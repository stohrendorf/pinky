const WARMUP_MS = 1000;
const MIN_PROGRESS = 0.01;
const SMOOTHING_SECONDS = 3;

interface Sample {
    time: number;
    progress: number;
}

// Only actual work samples advance the estimate; elapsed time never advances progress.
export function createExportEta(now: () => number = () => performance.now()) {
    let currentStage: string | null = null;
    let first: Sample | null = null;
    let previous: Sample | null = null;
    let speed: number | null = null;

    function reset(): void {
        currentStage = null;
        first = previous = null;
        speed = null;
    }

    function update(stage: string, progress: number | null): number | null {
        const time = now();
        if (stage !== currentStage) {
            reset();
            currentStage = stage;
        }
        if (progress === null || !Number.isFinite(progress) || progress < 0 || progress >= 1 || !Number.isFinite(time)) {
            reset();
            return null;
        }
        if (!first || !previous || progress < previous.progress || time < previous.time) {
            first = previous = {time, progress};
            speed = null;
            return null;
        }
        const elapsed = (time - previous.time) / 1000;
        const advanced = progress - previous.progress;
        // A stalled sample hides the ETA. Keep its elapsed time in the next speed observation.
        if (elapsed <= 0 || advanced <= 0) {return null;}
        const observedSpeed = advanced / elapsed;
        const weight = 1 - Math.exp(-elapsed / SMOOTHING_SECONDS);
        speed = speed === null ? observedSpeed : speed + weight * (observedSpeed - speed);
        previous = {time, progress};
        if (time - first.time < WARMUP_MS || progress - first.progress < MIN_PROGRESS || speed <= 0) {return null;}
        const remaining = (1 - progress) / speed;
        return Number.isFinite(remaining) && remaining >= 0 ? remaining : null;
    }

    return {update, reset};
}

export function formatStageEta(seconds: number | null | undefined): string | null {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {return null;}
    const roundedSeconds = Math.max(1, seconds < 10 ? Math.round(seconds) : Math.round(seconds / 5) * 5);
    const minutes = Math.round(seconds / 60);
    const duration = roundedSeconds < 60 ? `${roundedSeconds} s`
        : minutes < 60 ? `${minutes} min` : `${Math.round(seconds / 3600)} h`;
    return `Approx. ${duration} left in this stage`;
}