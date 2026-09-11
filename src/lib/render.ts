/* Offline render — bounce the arrangement to a WAV file.
 * The engine graph is rebuilt on an OfflineAudioContext, the scheduler writes
 * the whole song into its future in chunks, and the resulting AudioBuffer is
 * encoded as 16-bit PCM. Faster than real time and independent of the audio
 * clock, so the export is always glitch-free. */
import type { Writable } from "svelte/store";

import { get, readonly, writable } from "svelte/store";

import type { Project } from "./types";

import * as eng from "./engine";
import { createExportEta } from "./export-eta";
import { mixerTailSeconds, resolveMixer } from "./mixer";
import { checkAbort, yieldExport } from "./offline-progress";
import { playing, project } from "./project";
import { createTimingMap } from "./timing";
import {
  scheduleRangeAsync,
  songLengthSteps,
  stopTransport,
} from "./transport";
import { encodeWavAsync } from "./wav";

export const rendering: Writable<boolean> = writable(false);

export interface ExportProgressState {
  stage: "preparing" | "scheduling" | "rendering" | "encoding" | "error";
  progress: number | null;
  cancelling: boolean;
  canSuspend?: boolean;
  etaSeconds?: number | null;
  error?: string;
}

export interface WavExportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgressState) => void;
}

const progressState = writable<ExportProgressState | null>(null);
export const exportProgress = readonly(progressState);
let activeExport: AbortController | null = null;

export function cancelExport(): void {
  activeExport?.abort();
}

export function dismissExportError(): void {
  if (!get(rendering)) {
    progressState.set(null);
  }
}

const RENDER_RATE = 44100;
const TAIL = 3; // seconds of room for release tails + reverb

/* Renders the arrangement — or, if a loop region is marked, exactly that
 * section (same as what playback does). Returns null when there is nothing
 * to render. */
export async function renderSongToWav(
  options: WavExportOptions = {},
): Promise<Blob | null> {
  return performExport(false, options);
}

async function performExport(
  download: boolean,
  options: WavExportOptions,
): Promise<Blob | null> {
  if (get(rendering) || eng.isRendering()) {
    throw new Error("An offline render is already in progress");
  }
  checkAbort(options.signal);
  const current = get(project);
  if (!current || !current.arrangement.length) {
    return null;
  }
  const p = JSON.parse(JSON.stringify(current)) as Project;
  const lp = p.loop;
  const from = lp && lp.end > lp.start ? Math.max(0, Math.round(lp.start)) : 0;
  const to = lp && lp.end > lp.start ? Math.round(lp.end) : songLengthSteps(p);
  if (to <= from) {
    return null;
  }
  const release = Math.max(
    0,
    ...p.instruments.map((inst) => inst.params.rel),
    ...(p.automation || [])
      .filter((lane) => lane.param === "rel")
      .flatMap((lane) => lane.points.map((point) => point.value)),
  );
  const seconds =
    createTimingMap(p).secondsBetween(from, to) +
    release * 1.5 +
    TAIL +
    mixerTailSeconds(p.mixer);
  const controller = new AbortController();
  const signal = controller.signal;
  const eta = createExportEta();
  activeExport = controller;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  signal.addEventListener(
    "abort",
    () => {
      progressState.update((state) =>
        state ? { ...state, cancelling: true, etaSeconds: null } : state,
      );
    },
    { once: true },
  );
  const report = (
    stage: ExportProgressState["stage"],
    progress: number | null,
    canSuspend?: boolean,
  ) => {
    checkAbort(signal);
    const state: ExportProgressState = {
      stage,
      progress,
      canSuspend,
      cancelling: false,
      etaSeconds: eta.update(stage, progress),
    };
    progressState.set(state);
    options.onProgress?.(state);
    checkAbort(signal);
  };
  rendering.set(true);
  try {
    report("preparing", null);
    // Let the modal mount before allocating the offline graph.
    await yieldExport(signal);
    if (get(playing)) {
      stopTransport();
    }
    const buf = await eng.renderOffline(
      seconds,
      RENDER_RATE,
      () =>
        scheduleRangeAsync(p, from, to, {
          signal,
          onProgress: (progress) => report("scheduling", progress),
        }),
      {
        mixer: p.mixer,
        instrumentIds: p.instruments.map((inst) => inst.id),
        master: resolveMixer(p.mixer, []).master,
      },
      {
        signal,
        onProgress: ({ stage, progress, canSuspend }) =>
          report(stage, progress, canSuspend),
      },
    );
    checkAbort(signal);
    report("encoding", 0);
    const blob = await encodeWavAsync(buf, {
      signal,
      onProgress: (progress) => report("encoding", progress),
    });
    // Include the download in the same cancellation/ownership boundary.
    checkAbort(signal);
    if (download) {
      downloadBlob(blob, "pinky-song.wav");
    }
    progressState.set(null);
    return blob;
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      progressState.set(null);
      throw new DOMException("Export cancelled", "AbortError");
    }
    progressState.set({
      stage: "error",
      progress: null,
      cancelling: false,
      error:
        "Render failed: " +
        (error instanceof Error ? error.message : String(error)),
    });
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    activeExport = null;
    rendering.set(false);
  }
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  try {
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Returns '' on success, an error message otherwise
export async function exportWav(
  options: WavExportOptions = {},
): Promise<string> {
  try {
    const blob = await performExport(true, options);
    if (!blob) {
      const error = "Nothing to render — the arranger is empty.";
      progressState.set({
        stage: "error",
        progress: null,
        cancelling: false,
        error,
      });
      return error;
    }
    return "";
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return "";
    }
    return "Render failed: " + (e instanceof Error ? e.message : String(e));
  }
}
