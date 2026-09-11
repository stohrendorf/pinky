import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { Project } from "./types";

import axelf from "../../pinky-axelf.json";
import diva from "../../pinky-diva.json";
import noise from "../../pinky-noise.json";
import toccata from "../../pinky-toccata.json";

const DEMOS: {
  song: string;
  data: Project;
  payloadHash: string;
  originalHash: string;
  groups: Record<string, number>;
  roots: string[];
  families: Record<string, string[]>;
}[] = [
  {
    song: "axelf",
    data: axelf as unknown as Project,
    payloadHash:
      "161bff3f76c5e34f6da8a1aa60acceb8422d481b3bce59d7456d394c88098d3b",
    originalHash:
      "509bf316c8fa7bd5a6cf156bcc5df978a24c41c32a26f4a116db522e64bf2302",
    groups: { Drums: 6, Bass: 6, Synth: 7, Percussion: 2 },
    roots: ["answer", "arp", "sweep", "arp down"],
    families: {
      Drums: ["Drums/"],
      Bass: ["Bass/"],
      Synth: ["Synth/"],
      Percussion: ["Percussion/"],
    },
  },
  {
    song: "toccata",
    data: toccata as unknown as Project,
    payloadHash:
      "346b73349bd98e33d7ff72a864834f57952e4a747746ec11e9dd0da21cdcba09",
    originalHash:
      "656eaba262df1a8b75098d0fd4ed07c84a7e97752cbc1b335c80af20ce53bbda",
    groups: { Drums: 3, Percussion: 2, Bass: 2, Keys: 5, Strings: 5 },
    roots: [
      "dim arpeggio",
      "D major hit",
      "drum fill",
      "valkyrie tutti",
      "bells toll",
    ],
    families: {
      Drums: ["Drums/"],
      Percussion: ["Percussion/Tuned/Timpani"],
      Bass: ["Keys/Pedal 16ft", "Bass/Sub"],
      Keys: ["Keys/"],
      Strings: ["Orchestra/Strings/"],
    },
  },
  {
    song: "noise",
    data: noise as unknown as Project,
    payloadHash:
      "20045f64ab66192d291112742f874dc08db7583b28a1733ff139a9c7eadd624e",
    originalHash:
      "203872305fa8da48b74118bb34c3a65acef8fb275bebe8db29c4c8c94d2de998",
    groups: { FX: 4, Synth: 9, Drums: 7, Bass: 4, Vocals: 4 },
    roots: ["box doubling"],
    families: {
      FX: ["FX/"],
      Synth: ["Synth/"],
      Drums: ["Drums/"],
      Bass: ["Bass/"],
      Vocals: ["Vocals/"],
    },
  },
  {
    song: "diva",
    data: diva as unknown as Project,
    payloadHash:
      "ae3b5b04879daaa22ff78c37281d72a94a8a9083fe64dbd94d2d62c1a0b298ce",
    originalHash:
      "c14e79d235dc51e6e6f0b05581ffa7a40d60e7b05a4d0503df86c15af35f3b27",
    groups: {
      "Lead Vocal": 10,
      Choir: 6,
      Strings: 8,
      Harp: 3,
      Drums: 3,
      FX: 2,
      Keys: 3,
    },
    roots: [
      "Hinge — Bass wakes",
      "Machine I — Groove",
      "Machine II — Groove",
      "Machine III — Groove (Bb minor)",
      "Machine IV — Groove thins",
      "Machine V — Groove full",
      "Machine VI — Groove (B minor)",
    ],
    families: {
      "Lead Vocal": ["Vocals/Diva"],
      Choir: ["Vocals/Choir Bed"],
      Strings: ["Orchestra/Strings/"],
      Harp: ["Instruments/Plucked/Harp"],
      Drums: ["Drums/"],
      FX: ["FX/"],
      Keys: ["Keys/Glass Celesta"],
    },
  },
];

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("JSON demo organization", () => {
  // Captured from the original JSON before regrouping; omit pattern.name and nothing else.
  it.each(DEMOS)(
    "preserves the entire $song musical payload",
    ({ data, payloadHash }) => {
      const payload = structuredClone(data);
      for (const pattern of payload.patterns) {
        delete (pattern as { name?: string }).name;
      }
      expect(hash(payload)).toBe(payloadHash);
    },
  );

  it.each(DEMOS)(
    "preserves $song section and leaf names and only subdivides Main",
    ({ data, originalHash }) => {
      const original = structuredClone(data);
      for (const pattern of original.patterns) {
        const parts = pattern.name.split("/");
        if (parts.length > 2) {
          expect(parts).toHaveLength(3);
          expect(parts[0]).toBe("02 Main");
          pattern.name = `${parts[0]}/${parts[2]}`;
        }
      }
      expect(hash(original)).toBe(originalHash);
    },
  );

  it.each(DEMOS)(
    "keeps $song folders nonempty, unique and below 20 children",
    ({ data }) => {
      const children = new Map<string, Set<string>>();
      expect(new Set(data.patterns.map((pattern) => pattern.name)).size).toBe(
        data.patterns.length,
      );
      for (const pattern of data.patterns) {
        const parts = pattern.name.split("/");
        expect(pattern.name).toMatch(/^\d{2} [^/]+(?:\/[^/]+){1,2}$/);
        expect(
          parts.every((part) => part.trim().length > 0 && part === part.trim()),
        ).toBe(true);
        for (let index = 1; index < parts.length; index++) {
          const folder = parts.slice(0, index).join("/");
          const entries = children.get(folder) ?? new Set<string>();
          entries.add(parts[index]);
          children.set(folder, entries);
        }
      }
      for (const [folder, entries] of children) {
        expect(entries.size, folder).toBeGreaterThanOrEqual(
          folder.includes("/") ? 2 : 1,
        );
        expect(entries.size, folder).toBeLessThan(20);
      }
    },
  );

  it.each(DEMOS)(
    "groups $song by played instruments, leaving mixed and uncommon roles at the root",
    ({ data, groups, roots, families }) => {
      const main = data.patterns.filter((pattern) =>
        pattern.name.startsWith("02 Main/"),
      );
      const grouped = main.filter(
        (pattern) => pattern.name.split("/").length === 3,
      );
      const actual: Record<string, number> = {};
      for (const pattern of grouped) {
        const group = pattern.name.split("/")[1];
        actual[group] = (actual[group] ?? 0) + 1;
        const allowed = families[group];
        expect(allowed, pattern.name).toBeDefined();
        const played = Object.entries(pattern.tracks).filter(
          ([, notes]) => notes.length,
        );
        expect(played.length, pattern.name).toBeGreaterThan(0);
        for (const [id] of played) {
          const instrument = data.instruments.find((value) => value.id === id)!;
          expect(
            allowed.some((family) =>
              family.endsWith("/")
                ? instrument.name.startsWith(family)
                : instrument.name === family,
            ),
            pattern.name,
          ).toBe(true);
        }
      }
      expect(actual).toEqual(groups);
      expect(
        main
          .filter((pattern) => pattern.name.split("/").length === 2)
          .map((pattern) => pattern.name.split("/")[1]),
      ).toEqual(roots);
    },
  );

  it.each(DEMOS)(
    "retains valid $song instrument, pattern, track and automation references",
    ({ data }) => {
      const instruments = new Set(
        data.instruments.map((instrument) => instrument.id),
      );
      const patterns = new Set(data.patterns.map((pattern) => pattern.id));
      expect(instruments.size).toBe(data.instruments.length);
      expect(patterns.size).toBe(data.patterns.length);
      for (const pattern of data.patterns) {
        expect(
          Object.keys(pattern.tracks).every((id) => instruments.has(id)),
        ).toBe(true);
      }
      for (const clip of data.arrangement) {
        expect(patterns.has(clip.patternId)).toBe(true);
        expect(Number.isInteger(clip.track)).toBe(true);
        expect(clip.track).toBeGreaterThanOrEqual(0);
        expect(clip.track).toBeLessThan(data.tracks.length);
      }
      for (const lane of data.automation ?? []) {
        expect(lane.target === "master" || instruments.has(lane.target)).toBe(
          true,
        );
      }
      expect(
        data.automationOrder?.every((id) =>
          data.automation?.some((lane) => lane.id === id),
        ),
      ).toBe(true);
    },
  );
});
