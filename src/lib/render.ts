/* Offline render — bounce the arrangement to a WAV file.
 * The engine graph is rebuilt on an OfflineAudioContext, the scheduler writes
 * the whole song into its future in one go, and the resulting AudioBuffer is
 * encoded as 16-bit PCM. Faster than real time and independent of the audio
 * clock, so the export is always glitch-free. */
import type {
    Writable
} from 'svelte/store';

import {
    get, writable
} from 'svelte/store';

import * as eng from './engine';
import {
    playing, project
} from './project';
import {
    scheduleRange, songLengthSteps, stopTransport
} from './transport';
import {
    encodeWav
} from './wav';

export const rendering: Writable<boolean> = writable(false);

const RENDER_RATE = 44100;
const TAIL = 3; // seconds of room for release tails + reverb


/* Renders the arrangement — or, if a loop region is marked, exactly that
 * section (same as what playback does). Returns null when there is nothing
 * to render. */
export async function renderSongToWav(): Promise<Blob | null> {
    const p = get(project);
    if (!p || !p.arrangement.length) {return null;}
    // the engine graph is swapped during the render, so live playback has to stop
    if (get(playing)) {stopTransport();}
    const lp = p.loop;
    const from = lp && lp.end > lp.start ? Math.max(0, Math.round(lp.start)) : 0;
    const to = lp && lp.end > lp.start ? Math.round(lp.end) : songLengthSteps(p);
    if (to <= from) {return null;}
    const dur = 60 / (p.bpm || 112) / 4;
    const seconds = (to - from) * dur + TAIL;
    rendering.set(true);
    try {
        const buf = await eng.renderOffline(seconds, RENDER_RATE, () => scheduleRange(p, from, to));
        return encodeWav(buf);
    } finally {
        rendering.set(false);
    }
}

export function downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Returns '' on success, an error message otherwise
export async function exportWav(): Promise<string> {
    try {
        const blob = await renderSongToWav();
        if (!blob) {return 'Nothing to render — the arranger is empty.';}
        downloadBlob(blob, 'pinky-song.wav');
        return '';
    } catch (e) {
        return 'Render failed: ' + ((e as Error)?.message || e);
    }
}
