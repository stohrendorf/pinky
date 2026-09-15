/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportProgressState } from "../lib/render";

import ExportProgress from "./ExportProgress.svelte";

const current = vi.hoisted(() => {
  let value: ExportProgressState | null = null;
  const subscribers = new Set<(state: ExportProgressState | null) => void>();

  return {
    exportProgress: {
      subscribe(run: (state: ExportProgressState | null) => void) {
        subscribers.add(run);
        run(value);
        return () => subscribers.delete(run);
      },
    },
    set(state: ExportProgressState | null) {
      value = state;
      for (const run of subscribers) {
        run(value);
      }
    },
  };
});
vi.mock("../lib/render", () => ({
  exportProgress: current.exportProgress,
  cancelExport: vi.fn(),
  dismissExportError: vi.fn(),
  exportWav: vi.fn(),
}));

async function setProgress(state: ExportProgressState) {
  current.set(state);
  await tick();
}

async function show(state: ExportProgressState) {
  await setProgress(state);
  render(ExportProgress);
  await tick();
}

beforeEach(() => {
  HTMLDialogElement.prototype.close = vi.fn(function close(
    this: HTMLDialogElement,
  ) {
    this.removeAttribute("open");
  });
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
});

afterEach(() => {
  cleanup();
  current.set(null);
  vi.restoreAllMocks();
});

describe("export progress modal", () => {
  it.each([null, 0, 0.45, 1])(
    "cancels non-suspendable renders without waiting for native completion at progress %s",
    async (progress) => {
      const state: ExportProgressState = {
        stage: "rendering",
        progress,
        cancelling: false,
        canSuspend: false,
      };
      await show(state);
      expect(
        screen.queryByText("Cancellation waits for rendering to finish."),
      ).toBeNull();
      await setProgress({ ...state, cancelling: true });
      expect(screen.getByRole("status").textContent).toBe("Cancelling…");
      expect(
        screen.getByText(/No file is downloaded after cancellation\./),
      ).not.toBeNull();
    },
  );

  it.each([true, undefined])(
    "does not infer suspension support from null progress (%s)",
    async (canSuspend) => {
      await show({
        stage: "rendering",
        progress: null,
        cancelling: true,
        canSuspend,
      });
      expect(screen.getByRole("status").textContent).toBe("Cancelling…");
      expect(
        screen.queryByText("Cancellation waits for rendering to finish."),
      ).toBeNull();
    },
  );

  it("distinguishes waiting for telemetry from graph initialization", async () => {
    await show({
      stage: "rendering",
      progress: null,
      cancelling: false,
      canSuspend: false,
    });
    expect(screen.getByText("Waiting for audio progress…")).not.toBeNull();
    await setProgress({
      stage: "preparing",
      progress: null,
      cancelling: false,
    });
    expect(screen.getByText("Initializing the audio graph…")).not.toBeNull();
  });

  it("labels the ETA as approximate and stage-local and hides it during cancellation or errors", async () => {
    const state: ExportProgressState = {
      stage: "rendering",
      progress: 0.45,
      cancelling: false,
      etaSeconds: 125,
    };
    await show(state);
    expect(screen.getByText("45% of this stage")).not.toBeNull();
    expect(screen.getByText("Approx. 2 min left in this stage")).not.toBeNull();
    await setProgress({ ...state, cancelling: true });
    expect(screen.queryByText(/left in this stage/)).toBeNull();
    await setProgress({ ...state, stage: "error", error: "Render failed" });
    expect(screen.queryByText(/left in this stage/)).toBeNull();
    await setProgress({ ...state, etaSeconds: null });
    expect(screen.queryByText(/left in this stage/)).toBeNull();
  });
});
