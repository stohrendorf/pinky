import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../lib/types";

import { createInstrument } from "../lib/instruments";
import {
  activeDemo,
  lastPlayedPitch,
  playing,
  project,
  savedAt,
  selInstId,
  selPatId,
  songCursor,
  songLabel,
} from "../lib/project";
import TopBar from "./TopBar.svelte";

const external = vi.hoisted(() => ({
  exportWav: vi.fn(),
  playSong: vi.fn(),
  seekSong: vi.fn(),
  stopTransport: vi.fn(),
}));

vi.mock("../lib/render", () => ({
  cancelExport: vi.fn(),
  dismissExportError: vi.fn(),
  exportProgress: {
    subscribe: (run: (value: null) => void) => (run(null), () => {}),
  },
  exportWav: external.exportWav,
  rendering: {
    subscribe: (run: (value: boolean) => void) => (run(false), () => {}),
  },
}));

vi.mock("../lib/transport", () => ({
  playSong: external.playSong,
  seekSong: external.seekSong,
  stopTransport: external.stopTransport,
}));

function fixture(): Project {
  const instrument = createInstrument("Original bass");
  return {
    arrangement: [],
    bpm: 120,
    formatVersion: 1,
    instruments: [instrument],
    patterns: [],
    swing: 0,
    tracks: [],
    zoom: { seq: { height: 1, width: 1 }, arr: { height: 1, width: 1 } },
  };
}

beforeEach(() => {
  external.exportWav.mockReset();
  external.playSong.mockReset();
  external.seekSong.mockReset();
  external.stopTransport.mockReset();
  localStorage.clear();
  project.set(fixture());
  activeDemo.set(null);
  lastPlayedPitch.set("D4");
  playing.set(false);
  savedAt.set(0);
  selInstId.set(null);
  selPatId.set(null);
  songCursor.set(0);
  songLabel.set("Original song");
});

afterEach(() => cleanup());

describe("TopBar main menu and desktop controls", () => {
  it("opens the main menu, moves focus to its first action, and dismisses with Escape", async () => {
    render(TopBar);
    const brand = screen.getByRole("button", { name: /pinky/i });

    await fireEvent.click(brand);
    await tick();
    const menu = screen.getByRole("dialog", { name: "Pinky main menu" });
    expect(document.activeElement).toBe(
      within(menu).getByRole("button", { name: "New project" }),
    );

    await fireEvent.keyDown(menu, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Pinky main menu" }),
    ).toBeNull();
    expect(document.activeElement).not.toBe(brand);
  });

  it("navigates main-menu actions with arrow, Home, and End keys without choosing one", async () => {
    render(TopBar);
    await fireEvent.click(screen.getByRole("button", { name: /pinky/i }));
    const menu = screen.getByRole("dialog", { name: "Pinky main menu" });
    const buttons = within(menu)
      .getAllByRole("button")
      .filter((button) => !button.hasAttribute("disabled"));

    buttons[0].focus();
    await fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    await fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(buttons.at(-1));
    await fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
    expect(external.stopTransport).not.toHaveBeenCalled();
  });

  it("loads a demo and lets the listener restore the project being explored", async () => {
    render(TopBar);
    await fireEvent.click(screen.getByRole("button", { name: /pinky/i }));
    await fireEvent.click(screen.getByRole("button", { name: "Axel F" }));

    expect(external.stopTransport).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("dialog", { name: "Pinky main menu" }),
    ).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: /pinky/i }));
    await fireEvent.click(
      screen.getByRole("button", { name: "Restore previous project" }),
    );
    expect(get(project)?.instruments[0].name).toBe("Original bass");
    expect(get(activeDemo)).toBeNull();
  });

  it("bounds timing input and invokes direct transport controls", async () => {
    render(TopBar);
    const tempo = screen.getByLabelText("Tempo (BPM)");
    const swing = screen.getByLabelText("Swing (%)");

    await fireEvent.change(tempo, { target: { valueAsNumber: 999 } });
    await fireEvent.change(swing, { target: { valueAsNumber: -1 } });
    expect(get(project)?.bpm).toBe(300);
    expect(get(project)?.swing).toBe(0);

    await fireEvent.click(screen.getByRole("button", { name: "Play song" }));
    songCursor.set(8);
    await tick();
    await fireEvent.click(
      screen.getByRole("button", { name: "Back to start" }),
    );
    expect(external.playSong).toHaveBeenCalledOnce();
    expect(external.seekSong).toHaveBeenCalledWith(0);
  });

  it("closes the menu before starting an audio export", async () => {
    let finish!: () => void;
    external.exportWav.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(TopBar);
    const brand = screen.getByRole("button", { name: /pinky/i });

    await fireEvent.click(brand);
    await fireEvent.click(screen.getByRole("button", { name: "Audio (.wav)" }));
    expect(
      screen.queryByRole("dialog", { name: "Pinky main menu" }),
    ).toBeNull();
    expect(external.exportWav).toHaveBeenCalledOnce();
    finish();
    await tick();
  });
});
