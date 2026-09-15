/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Project } from "../lib/types";

import { createInstrument } from "../lib/instruments";
import { project, selInstId, selPatId } from "../lib/project";
import InstrumentTree from "./InstrumentTree.svelte";

function fixture(): Project {
  const lead = createInstrument("Lead");
  const bass = createInstrument("Bass");
  return {
    formatVersion: 1,
    instruments: [lead, bass],
    patterns: [
      {
        id: "lead-pattern",
        name: "Lead pattern",
        steps: 16,
        color: "#53d8fb",
        tracks: { [lead.id]: [{ pitch: "C4", start: 0, len: 4 }] },
      },
      {
        id: "bass-pattern",
        name: "Bass pattern",
        steps: 16,
        color: "#ff9f43",
        tracks: { [bass.id]: [{ pitch: "C2", start: 0, len: 4 }] },
      },
    ],
    arrangement: [],
    tracks: [],
    bpm: 120,
    zoom: { seq: { width: 24, height: 14 }, arr: { width: 1, height: 1 } },
  };
}

beforeEach(() => {
  const value = fixture();
  project.set(value);
  selInstId.set(value.instruments[0].id);
  selPatId.set(value.patterns[0].id);
});

afterEach(() => {
  cleanup();
  project.set(null);
  selInstId.set(null);
  selPatId.set(null);
});

describe("InstrumentTree", () => {
  it("marks only instruments with notes in the current pattern", async () => {
    render(InstrumentTree);

    expect(screen.getAllByLabelText("Used in current pattern")).toHaveLength(1);
    expect(
      screen
        .getByTitle("Lead")
        .contains(screen.getByLabelText("Used in current pattern")),
    ).toBe(true);

    selPatId.set("bass-pattern");
    await tick();

    expect(screen.getAllByLabelText("Used in current pattern")).toHaveLength(1);
    expect(
      screen
        .getByTitle("Bass")
        .contains(screen.getByLabelText("Used in current pattern")),
    ).toBe(true);
  });
});
