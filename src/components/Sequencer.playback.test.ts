import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../lib/types";

import { createInstrument } from "../lib/instruments";
import {
  playing,
  playMode,
  project,
  selInstId,
  selPatId,
} from "../lib/project";
import { rendering } from "../lib/render";
import Sequencer from "./Sequencer.svelte";

const transport = vi.hoisted(() => ({
  playPattern: vi.fn(),
  stopTransport: vi.fn(),
}));

vi.mock("../lib/engine", () => ({
  ensureAudio: vi.fn(),
  glideAt: vi.fn(),
  noteOff: vi.fn(),
  noteOnAt: vi.fn(),
}));
vi.mock("../lib/transport", () => transport);

function setProject(): Project {
  const instrument = createInstrument("Lead");
  const value: Project = {
    formatVersion: 1,
    instruments: [instrument],
    patterns: [
      {
        id: "pattern",
        name: "Pattern",
        steps: 16,
        color: "#53d8fb",
        tracks: {},
      },
    ],
    arrangement: [],
    tracks: [],
    bpm: 120,
    zoom: { seq: { width: 24, height: 14 }, arr: { width: 1, height: 1 } },
  };
  project.set(value);
  selInstId.set(instrument.id);
  selPatId.set("pattern");
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  project.set(null);
  selInstId.set(null);
  selPatId.set(null);
  playing.set(false);
  playMode.set("");
  rendering.set(false);
});

afterEach(() => {
  cleanup();
});

describe("pattern auditioning", () => {
  it("renders an accessible icon-only pattern audition toggle", () => {
    setProject();
    render(Sequencer);

    const toggle = screen.getByRole("button", { name: "Play pattern" });
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.getAttribute("title")).toBe(
      "Play selected pattern on repeat (Shift+Space)",
    );
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.textContent).toBe("");
  });

  it("starts auditioning unless the pattern is already playing, then stops it", async () => {
    setProject();
    render(Sequencer);
    const toggle = screen.getByRole("button", { name: "Play pattern" });

    await fireEvent.click(toggle);
    expect(transport.playPattern).toHaveBeenCalledOnce();
    expect(transport.stopTransport).not.toHaveBeenCalled();

    playing.set(true);
    playMode.set("pattern");
    await tick();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("title")).toBe(
      "Stop pattern playback (Shift+Space)",
    );
    await fireEvent.click(toggle);
    expect(transport.stopTransport).toHaveBeenCalledOnce();
  });

  it("disables auditioning while an export is active", async () => {
    setProject();
    render(Sequencer);
    rendering.set(true);
    await tick();
    expect(screen.getByRole("button", { name: "Play pattern" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
