import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../lib/types";

import { createInstrument } from "../lib/instruments";
import {
  activeDemo,
  DEMO_LIBRARY,
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

const rendering = vi.hoisted(() => ({ value: false }));

vi.mock("../lib/render", () => ({
  cancelExport: vi.fn(),
  dismissExportError: vi.fn(),
  exportProgress: {
    subscribe: (run: (value: null) => void) => (run(null), () => {}),
  },
  exportWav: vi.fn(),
  rendering: {
    subscribe: (run: (value: boolean) => void) => (
      run(rendering.value),
      () => {}
    ),
  },
}));

vi.mock("../lib/transport", () => ({
  playSong: vi.fn(),
  seekSong: vi.fn(),
  stopTransport: vi.fn(),
}));

function fixture(): Project {
  const instrument = createInstrument("Bass");
  return {
    arrangement: [],
    bpm: 120,
    formatVersion: 1,
    instruments: [instrument],
    patterns: [],
    tracks: [],
    zoom: { seq: { height: 1, width: 1 }, arr: { height: 1, width: 1 } },
  };
}

beforeEach(() => {
  rendering.value = false;
  localStorage.clear();
  project.set(fixture());
  activeDemo.set(null);
  lastPlayedPitch.set("C4");
  playing.set(false);
  savedAt.set(0);
  selInstId.set(null);
  selPatId.set(null);
  songCursor.set(0);
  songLabel.set("Untitled song");
});

afterEach(() => cleanup());

describe("TopBar desktop layout", () => {
  it("keeps transport and timing controls directly available beside the logo", () => {
    render(TopBar);

    const brand = screen.getByRole("button", { name: /pinky/i });
    expect(brand.getAttribute("aria-controls")).toBe("main-menu");
    expect(brand.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen
        .getByRole("link", { name: "Pinky on GitHub" })
        .getAttribute("href"),
    ).toBe("https://github.com/stohrendorf/pinky");
    expect(
      screen.getByRole("group", { name: "Transport and timing" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Play song" })).not.toBeNull();
    expect(screen.getByLabelText("Tempo (BPM)")).not.toBeNull();
    expect(screen.getByLabelText("Swing (%)")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Mixer" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Keyboard shortcuts (?)" }),
    ).not.toBeNull();
  });

  it("opens a named main menu containing project, export, and demo actions", async () => {
    render(TopBar);
    const brand = screen.getByRole("button", { name: /pinky/i });

    await fireEvent.click(brand);
    const menu = screen.getByRole("dialog", { name: "Pinky main menu" });
    expect(brand.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(menu).getByRole("heading", { name: "Project" }),
    ).not.toBeNull();
    expect(
      within(menu).getByRole("button", { name: "New project" }),
    ).not.toBeNull();
    expect(
      within(menu).getByRole("button", { name: "Open project" }),
    ).not.toBeNull();
    expect(
      within(menu).getAllByRole("button", { name: "Save to browser" }),
    ).toHaveLength(1);
    expect(
      within(menu).getByRole("heading", { name: "Export" }),
    ).not.toBeNull();
    expect(
      within(menu).getByRole("button", { name: "Project file (.json)" }),
    ).not.toBeNull();
    expect(
      within(menu).getByRole("button", { name: "Audio (.wav)" }),
    ).not.toBeNull();
    expect(within(menu).getByRole("heading", { name: "Demos" })).not.toBeNull();
  });

  it("renders the shared demos with descriptions and marks the active demo", async () => {
    activeDemo.set(DEMO_LIBRARY[0].id);
    render(TopBar);

    await fireEvent.click(screen.getByRole("button", { name: /pinky/i }));
    for (const demo of DEMO_LIBRARY) {
      const button = screen.getByRole("button", { name: demo.label });
      expect(button.getAttribute("title")).toBe(demo.title);
      expect(button.getAttribute("aria-pressed")).toBe(
        demo.id === DEMO_LIBRARY[0].id ? "true" : "false",
      );
    }
  });

  it("shows master and performance controls in the Audio panel", async () => {
    render(TopBar);

    await fireEvent.click(screen.getByRole("button", { name: /audio/i }));
    const panel = screen.getByRole("dialog", { name: "Audio" });
    expect(
      within(panel).getByRole("heading", { name: "Master" }),
    ).not.toBeNull();
    expect(
      within(panel).getByRole("heading", { name: "Performance" }),
    ).not.toBeNull();
    expect(within(panel).getAllByRole("slider").length).toBeGreaterThan(1);
    expect(
      screen
        .getByRole("button", { name: /audio/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("disables menu and transport actions while audio is rendering", async () => {
    rendering.value = true;
    render(TopBar);

    expect(
      screen.getByRole("button", { name: /pinky/i }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Play song" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByLabelText("Tempo (BPM)").hasAttribute("disabled")).toBe(
      true,
    );
  });
});
