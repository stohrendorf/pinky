import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../lib/types";

import { createInstrument } from "../lib/instruments";
import { lastPlayedPitch, project, selInstId } from "../lib/project";
import InstrumentPanel from "./InstrumentPanel.svelte";

vi.mock("../lib/engine", () => ({
  audioSampleRate: () => 48_000,
}));

function fixture(): Project {
  const bass = createInstrument("Bass");
  const lead = createInstrument("Lead");
  return {
    arrangement: [],
    bpm: 120,
    formatVersion: 1,
    instruments: [bass, lead],
    patterns: [],
    tracks: [],
    zoom: { seq: { height: 1, width: 1 }, arr: { height: 1, width: 1 } },
  };
}

beforeEach(() => {
  const value = fixture();
  project.set(value);
  selInstId.set(value.instruments[0].id);
  lastPlayedPitch.set("D4");
});

afterEach(() => cleanup());

describe("InstrumentPanel guided editing", () => {
  it("shows starter controls in Sound and updates their displayed value", async () => {
    render(InstrumentPanel);
    expect(
      screen.getByRole("tablist", { name: "Instrument settings" }),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "EQ Voice" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Envelope" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Mix" })).not.toBeNull();

    const tone = screen.getByRole("slider", {
      name: /tone level/i,
    });
    await fireEvent.input(tone, { target: { value: "0.4" } });
    await tick();
    expect(tone.value).toBe("0.4");
    expect(screen.getByText("0.4", { selector: ".value" })).not.toBeNull();
  });

  it("organizes specialist controls in Motion and keeps the filter preview visible", async () => {
    render(InstrumentPanel);
    expect(screen.getByLabelText("Filter response preview")).not.toBeNull();

    await fireEvent.click(screen.getByRole("tab", { name: "Motion" }));
    expect(screen.getByRole("heading", { name: "Percussion" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Formants" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Vibrato" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Unison" })).not.toBeNull();
    expect(screen.getByLabelText("Filter response preview")).not.toBeNull();
  });

  it("opens focused help with an optional deeper explanation", async () => {
    render(InstrumentPanel);
    await fireEvent.click(screen.getByRole("tab", { name: "Motion" }));
    await fireEvent.click(
      screen.getByRole("button", { name: "Learn about Formants" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Formants" });
    expect(dialog.textContent).toContain("fixed resonances");
    expect(
      screen.getByText("Go deeper: how a filter can suggest a voice"),
    ).not.toBeNull();
  });

  it("selects another instrument through the hierarchical picker", async () => {
    render(InstrumentPanel);
    const picker = screen.getByRole("button", { name: "Select instrument" });

    await fireEvent.click(picker);
    const tree = screen.getByRole("tree", { name: "Select instrument" });
    await fireEvent.click(screen.getByRole("treeitem", { name: "Lead" }));
    expect(tree).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Select instrument" }).textContent,
    ).toContain("Lead");
  });

  it("toggles mute and solo state and provides instrument identity actions", async () => {
    render(InstrumentPanel);
    const mute = screen.getByRole("button", { name: "Mute" });
    const solo = screen.getByRole("button", { name: "Solo" });

    await fireEvent.click(mute);
    await fireEvent.click(solo);
    expect(get(project)?.instruments[0].mute).toBe(true);
    expect(get(project)?.instruments[0].solo).toBe(true);
    expect(
      screen.getByRole("button", { name: "Rename Instrument" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Delete Instrument" }),
    ).not.toBeNull();
  });

  it("switches to harmonics editing while retaining contextual help and filter feedback", async () => {
    render(InstrumentPanel);
    await fireEvent.click(screen.getByRole("tab", { name: "Harmonics" }));

    expect(
      screen.getByRole("button", { name: "Learn about Harmonics" }),
    ).not.toBeNull();
    expect(screen.getByLabelText("Filter response preview")).not.toBeNull();
  });
});
