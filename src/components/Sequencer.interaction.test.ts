import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Note, Project } from "../lib/types";

import { INSTRUMENT_AUTO_PARAMS } from "../lib/automation";
import { createInstrument } from "../lib/instruments";
import {
  curStep,
  lastPlayedPitch,
  playing,
  playMode,
  project,
  selInstId,
  selPatId,
} from "../lib/project";
import { rendering } from "../lib/render";
import Sequencer from "./Sequencer.svelte";

const audio = vi.hoisted(() => ({
  ensureAudio: vi.fn(),
  glideAt: vi.fn(() => false),
  noteOff: vi.fn(),
  noteOnAt: vi.fn(),
}));

vi.mock("../lib/engine", () => audio);
vi.mock("../lib/transport", () => ({
  playPattern: vi.fn(),
  stopTransport: vi.fn(),
}));

function fixture(notes: Note[] = []): Project {
  const instrument = createInstrument("Lead");
  return {
    formatVersion: 1,
    instruments: [instrument],
    patterns: [
      {
        id: "pattern",
        name: "Pattern",
        steps: 16,
        color: "#53d8fb",
        tracks: { [instrument.id]: notes },
      },
    ],
    arrangement: [],
    tracks: [],
    bpm: 120,
    zoom: { seq: { width: 24, height: 14 }, arr: { width: 1, height: 1 } },
  };
}

function renderSequencer(notes: Note[] = []) {
  const value = fixture(notes);
  project.set(value);
  selInstId.set(value.instruments[0].id);
  selPatId.set("pattern");
  return { value, ...render(Sequencer) };
}

beforeEach(() => {
  vi.clearAllMocks();
  audio.ensureAudio.mockResolvedValue(undefined);
  audio.glideAt.mockReturnValue(false);
  project.set(null);
  selInstId.set(null);
  selPatId.set(null);
  playing.set(false);
  playMode.set("");
  curStep.set(-1);
  rendering.set(false);
});

afterEach(() => {
  cleanup();
});

describe("Sequencer note interactions", () => {
  it("edits shared properties and resolves mixed overrides for selected notes", async () => {
    const tone = INSTRUMENT_AUTO_PARAMS.find(({ param }) => param === "tone")!;
    const first: Note = {
      pitch: "C5",
      start: 0,
      len: 2,
      vel: 0.35,
      selected: true,
      overrides: { tone: 0.2 },
      legatoTo: { pitch: "E5", start: 2, curve: "linear" },
    };
    const second: Note = {
      pitch: "E5",
      start: 2,
      len: 2,
      vel: 0.8,
      selected: true,
      overrides: { tone: 0.8 },
    };
    const { value } = renderSequencer([first, second]);

    expect(screen.getByLabelText("Selected note properties")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /C5, velocity 35 percent/i })
        .classList.contains("selected"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: /C5, velocity 35 percent/i })
        .classList.contains("has-overrides"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: /E5, velocity 80 percent/i })
        .classList.contains("selected"),
    ).toBe(true);
    expect(
      screen
        .getByLabelText("Selected notes velocity percentage")
        .getAttribute("placeholder"),
    ).toBe("Mixed");
    expect(
      screen
        .getByLabelText(`Override ${tone.label}`)
        .getAttribute("placeholder"),
    ).toBe("Mixed");

    await fireEvent.input(screen.getByLabelText("Selected notes velocity"), {
      target: { value: "65" },
    });
    expect(
      value.patterns[0].tracks[value.instruments[0].id].map((note) => note.vel),
    ).toEqual([0.65, 0.65]);

    await fireEvent.input(
      screen.getByLabelText(`Resolve mixed ${tone.label}`),
      {
        target: { value: "0.5" },
      },
    );
    expect(
      value.patterns[0].tracks[value.instruments[0].id].map(
        (note) => note.overrides?.tone,
      ),
    ).toEqual([0.5, 0.5]);
    expect(screen.getByLabelText(`Adjust ${tone.label}`).value).toBe("0.5");
  });

  it("lets a sequential selection edit and remove pitch slides", async () => {
    const first: Note = {
      pitch: "C5",
      start: 0,
      len: 2,
      selected: true,
      legatoTo: { pitch: "E5", start: 2, curve: "linear" },
    };
    const second: Note = { pitch: "E5", start: 2, len: 2, selected: true };
    const { value } = renderSequencer([first, second]);

    const type = screen.getByLabelText("Pitch slide type");
    expect((type as HTMLSelectElement).value).toBe("linear");
    expect(
      screen.getByRole("button", { name: "Create missing pitch slides" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Remove pitch slides" }),
    ).toHaveProperty("disabled", false);

    await fireEvent.change(type, { target: { value: "smooth" } });
    expect(
      value.patterns[0].tracks[value.instruments[0].id][0].legatoTo?.curve,
    ).toBe("smooth");
    await fireEvent.click(
      screen.getByRole("button", { name: "Remove pitch slides" }),
    );
    expect(
      value.patterns[0].tracks[value.instruments[0].id][0].legatoTo,
    ).toBeUndefined();
    expect(
      screen.getByRole("button", { name: "Create missing pitch slides" }),
    ).toHaveProperty("disabled", false);
  });

  it("supports focus, keyboard pattern resizing, and drag auditioning", async () => {
    const focus = vi.fn();
    const note: Note = { pitch: "C5", start: 0, len: 1, selected: true };
    const value = fixture([note]);
    project.set(value);
    selInstId.set(value.instruments[0].id);
    selPatId.set("pattern");
    render(Sequencer, { props: { onToggleFocus: focus } });
    await tick();

    await fireEvent.click(
      screen.getByRole("button", { name: "Focus pattern editor" }),
    );
    expect(focus).toHaveBeenCalledOnce();

    const resize = screen.getByRole("slider", {
      name: "Resize pattern length",
    });
    expect(resize.getAttribute("aria-valuenow")).toBe("16");
    await fireEvent.keyDown(resize, { key: "ArrowRight" });
    expect(get(project)?.patterns[0]?.steps).toBe(17);
    expect(screen.getByLabelText("Pattern length").textContent).toContain(
      "17 steps",
    );

    await fireEvent.mouseDown(
      screen.getByRole("button", { name: /C5, velocity 100 percent/i }),
      {
        button: 0,
        clientX: 1,
        clientY: 827,
      },
    );
    await waitFor(() => expect(audio.noteOnAt).toHaveBeenCalledOnce());
    expect(audio.noteOnAt).toHaveBeenCalledWith(
      "drag-preview",
      "C5",
      0,
      value.instruments[0].params,
      1,
    );
    expect(get(lastPlayedPitch)).toBe("C5");
  });

  it("renders playheads only for active occurrences of the open pattern", async () => {
    const { container, value } = renderSequencer();
    playing.set(true);
    playMode.set("pattern");
    curStep.set(19);
    await waitFor(() =>
      expect(container.querySelectorAll(".playhead")).toHaveLength(1),
    );
    expect(
      container.querySelector(".playhead")?.getAttribute("style"),
    ).toContain("left: 72px");

    value.arrangement = [
      { id: "one", patternId: "pattern", track: 0, start: 0, len: 16 },
      { id: "two", patternId: "pattern", track: 1, start: 8, len: 16 },
    ];
    value.tracks = [
      { name: "One", color: "#fff" },
      { name: "Two", color: "#fff" },
    ];
    project.set(value);
    playMode.set("song");
    curStep.set(12);
    await waitFor(() =>
      expect(container.querySelectorAll(".playhead")).toHaveLength(2),
    );
  });
});
