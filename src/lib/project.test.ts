import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PARAMS } from "./instruments";
import {
  activeDemo,
  cloneInstrument,
  importProject,
  initProject,
  loadDemoProject,
  newEmptyProject,
  project,
  renameInstrument,
  renamePattern,
  restoreSavedProject,
  saveProject,
  selInstId,
  selPatId,
} from "./project";
import { isProjectId, PROJECT_FORMAT_VERSION } from "./types";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

describe("project import", () => {
  it("initializes a complete default demo when no saved project is available", () => {
    initProject();

    const initial = get(project);
    expect(initial).not.toBeNull();
    expect(initial!.instruments.length).toBeGreaterThan(0);
    expect(initial!.patterns.length).toBeGreaterThan(0);
    expect(initial!.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(
      initial!.instruments.every((instrument) => isProjectId(instrument.id)),
    ).toBe(true);
    expect(initial!.patterns.every((pattern) => isProjectId(pattern.id))).toBe(
      true,
    );
    expect(
      initial!.arrangement.every(
        (clip) => isProjectId(clip.id) && isProjectId(clip.patternId),
      ),
    ).toBe(true);
    expect(get(selInstId)).toBe(initial!.instruments[0].id);
    expect(get(selPatId)).toBe(initial!.patterns[0].id);
  });

  it("rejects an incomplete current-version project", () => {
    const params = { ...DEFAULT_PARAMS };
    delete (params as Partial<typeof DEFAULT_PARAMS>).q;
    const incomplete = {
      formatVersion: PROJECT_FORMAT_VERSION,
      instruments: [{ id: "i1", name: "Lead", color: "#53d8fb", params }],
      patterns: [],
      arrangement: [],
      tracks: [],
      bpm: 120,
      zoom: { seq: { width: 24, height: 14 }, arr: { width: 24, height: 32 } },
    };

    expect(importProject(JSON.stringify(incomplete))).toBe(false);
  });

  it("rejects a project from another format instead of migrating it implicitly", () => {
    const current = get(project)!;
    expect(
      importProject(
        JSON.stringify({
          ...current,
          formatVersion: PROJECT_FORMAT_VERSION - 1,
        }),
      ),
    ).toBe(false);
  });

  it("logs why importing a malformed or incompatible song fails", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(importProject("not JSON")).toBe(false);
    expect(warning).toHaveBeenLastCalledWith(
      "[Pinky] Could not import the song: its JSON is invalid.",
      expect.any(SyntaxError),
    );

    warning.mockClear();
    expect(
      importProject(
        JSON.stringify({
          ...get(project),
          formatVersion: PROJECT_FORMAT_VERSION - 1,
        }),
      ),
    ).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      `[Pinky] Could not import the song: it uses project format ${PROJECT_FORMAT_VERSION - 1}, but this version requires ${PROJECT_FORMAT_VERSION}.`,
    );
  });

  it("upgrades and restores a compatible browser save after demo browsing", () => {
    const original = newEmptyProject();
    const legacy = JSON.parse(JSON.stringify(original)) as typeof original;
    legacy.bpm = 137;
    for (const instrument of legacy.instruments) {
      delete (instrument.params as Partial<typeof instrument.params>).partials;
      delete (instrument.params as Partial<typeof instrument.params>).noiseBend;
    }
    if (legacy.mixer) {
      delete (legacy.mixer.master as Partial<typeof legacy.mixer.master>)
        .driveDb;
      for (const channel of Object.values(legacy.mixer.channels)) {
        delete (channel as Partial<typeof channel>).compressor;
        delete (channel as Partial<typeof channel>).sends;
      }
    }
    localStorage.setItem("pinky-project-v1", JSON.stringify(legacy));

    loadDemoProject("axelf");
    expect(get(activeDemo)).toBe("axelf");
    expect(restoreSavedProject()).toBe(true);

    const restored = get(project)!;
    expect(restored.bpm).toBe(137);
    expect(get(activeDemo)).toBeNull();
    expect(
      restored.instruments.every(
        ({ params }) =>
          params.noiseBend === 0 && (params.partials?.length ?? 0) > 0,
      ),
    ).toBe(true);
    expect(restored.mixer?.master.driveDb).toBe(0);
    expect(
      Object.values(restored.mixer?.channels ?? {}).every(
        (channel) => channel.compressor && channel.sends,
      ),
    ).toBe(true);
  });

  it("reloads the browser save instead of the first demo", () => {
    const saved = get(project)!;
    saved.bpm = 149;
    saveProject();
    loadDemoProject("axelf");

    initProject();

    expect(get(project)!.bpm).toBe(149);
    expect(get(activeDemo)).toBeNull();
  });

  it("imports legacy browser saves with a non-UUID clip ID", () => {
    const legacy = newEmptyProject();
    const originalClipId = legacy.arrangement[0].id;
    legacy.arrangement[0].id = "old-clip-id";
    delete (legacy.instruments[0].params as Partial<typeof DEFAULT_PARAMS>)
      .partials;

    expect(importProject(JSON.stringify(legacy))).toBe(true);

    const imported = get(project)!;
    expect(imported.arrangement[0].id).not.toBe(originalClipId);
    expect(isProjectId(imported.arrangement[0].id)).toBe(true);
    expect(imported.instruments[0].params.partials?.length).toBeGreaterThan(0);
  });
});

describe("project identity updates", () => {
  it("clones an instrument with a new identity and independent harmonic settings", () => {
    initProject();
    const before = get(project)!;
    const source = before.instruments[0];

    cloneInstrument(source.id);

    const after = get(project)!;
    const clone = after.instruments.find(
      (instrument) => instrument.id === get(selInstId),
    )!;
    expect(after).not.toBe(before);
    expect(clone).toMatchObject({
      name: `${source.name} copy`,
      params: source.params,
    });
    expect(clone.id).not.toBe(source.id);
    expect(clone.color).not.toBe(source.color);
    expect(clone.params).not.toBe(source.params);
    expect(clone.params.partials).not.toBe(source.params.partials);
    expect(clone.params.partials![0]).not.toBe(source.params.partials![0]);
    expect(get(selInstId)).toBe(clone.id);
  });

  it("renames instruments and patterns with new reactive references", () => {
    initProject();
    const before = get(project)!;
    const instrument = before.instruments[0];
    const pattern = before.patterns[0];

    renameInstrument(instrument.id, "Renamed instrument");
    const afterInstrument = get(project)!;
    expect(afterInstrument).not.toBe(before);
    expect(afterInstrument.instruments).not.toBe(before.instruments);
    expect(afterInstrument.instruments[0]).not.toBe(instrument);
    expect(afterInstrument.instruments[0].name).toBe("Renamed instrument");

    renamePattern(pattern.id, "Renamed pattern");
    const afterPattern = get(project)!;
    expect(afterPattern).not.toBe(afterInstrument);
    expect(afterPattern.patterns).not.toBe(afterInstrument.patterns);
    expect(afterPattern.patterns[0]).not.toBe(pattern);
    expect(afterPattern.patterns[0].name).toBe("Renamed pattern");
  });

  it("ignores rename requests for missing project items", () => {
    initProject();
    const before = get(project)!;

    renameInstrument("missing", "No instrument");
    renamePattern("missing", "No pattern");

    expect(get(project)).toBe(before);
  });
});
