import { get } from "svelte/store";
import { describe, expect, it } from "vitest";

import type { DemoSong } from "./project";

import { DEFAULT_PARAMS } from "./instruments";
import { activeDemo, DEMO_LIBRARY, loadDemoProject, project } from "./project";
import { PROJECT_FORMAT_VERSION } from "./types";

const DEMO_SONGS: DemoSong[] = [
  "axelf",
  "toccata",
  "winter",
  "monsoon",
  "noise",
  "diva",
  "pocket",
  "chip",
  "promo",
];

describe("demo song selection", () => {
  it("keeps picker metadata and supported demo IDs in one registry", () => {
    expect(DEMO_LIBRARY.map((demo) => demo.id)).toEqual(DEMO_SONGS);
  });

  it.each(DEMO_SONGS)("keeps %s highlighted after loading it", (song) => {
    loadDemoProject(song);

    expect(get(activeDemo)).toBe(song);
    expect(get(project)).not.toBeNull();
  });

  it.each(DEMO_SONGS)(
    "stores complete current instrument parameters for %s",
    (song) => {
      loadDemoProject(song);

      expect(
        get(project)!.instruments.every(
          ({ params }) =>
            Object.keys(DEFAULT_PARAMS).every((key) => key in params) &&
            Array.isArray(params.partials) &&
            params.partials.length > 0,
        ),
      ).toBe(true);
      expect(get(project)!.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    },
  );

  it("stores explicit legato links in bundled demos", () => {
    loadDemoProject("monsoon");
    const monsoon = get(project)!;
    const monsoonNotes = monsoon.patterns.flatMap((pattern) =>
      Object.values(pattern.tracks).flat(),
    );
    expect(monsoonNotes).toContainEqual(
      expect.objectContaining({
        pitch: "D#6",
        start: 0,
        legatoTo: expect.objectContaining({
          pitch: "D6",
          start: 3,
          curve: "ease-out",
        }),
      }),
    );

    loadDemoProject("axelf");
    const axelf = get(project)!;
    const axelfNotes = axelf.patterns.flatMap((pattern) =>
      Object.values(pattern.tracks).flat(),
    );
    expect(axelfNotes.some((note) => note.legatoTo)).toBe(true);
  });

  it("does not add links to demos without legacy overlapping portamento notes", () => {
    loadDemoProject("diva");
    const diva = get(project)!;
    expect(
      diva.patterns
        .flatMap((pattern) => Object.values(pattern.tracks).flat())
        .some((note) => note.legatoTo),
    ).toBe(false);
  });
});
