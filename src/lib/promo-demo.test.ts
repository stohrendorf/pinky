import { describe, expect, it } from "vitest";

import { buildDemoProject, DEMO_LIBRARY } from "./project";
import {
  buildPromoDemo,
  PROMO_CHAPTERS,
  PROMO_ID,
  PROMO_LENGTH_STEPS,
  type PromoPart,
} from "./promo-demo";
import { promoScore } from "./promo-score";

/* The original promo soundtrack was a Python score (promo/promo/score.py,
 * before it became a reader of the bounce). The figures below are what that
 * score produced — the demo has to reproduce it note for note. */
const PYTHON_NOTE_COUNTS: Record<PromoPart, number> = {
  air: 1,
  bass: 72,
  bell: 4,
  boom: 7,
  clap: 22,
  hat: 128,
  impact: 2,
  kick: 41,
  lead: 16,
  ohat: 11,
  pad: 60,
  pluck: 112,
  riser: 2,
  snare: 34,
  strings: 32,
  sub: 4,
  voice: 11,
};
const PYTHON_EVENT_COUNTS = { boom: 5, hit: 2, kick: 41, snare: 22 };

// seconds come out of step arithmetic (0.15 s a step) — compare them rounded to the millisecond
const ms = (value: number): number => Math.round(value * 1000) / 1000;

describe("Pinky Promo demo", () => {
  const promo = buildPromoDemo();
  const score = promoScore(promo);

  it("bundles the trailer soundtrack in the demo library", () => {
    expect(DEMO_LIBRARY.some((demo) => demo.id === "promo")).toBe(true);
    expect(buildDemoProject("promo")).toEqual(promo);
    expect(promo.bpm).toBe(100);
    expect(
      Math.max(...promo.arrangement.map((clip) => clip.start + clip.len)),
    ).toBe(PROMO_LENGTH_STEPS);
    expect(score.length).toBeCloseTo(50.4, 6);
  });

  it("reproduces the Python score: every note of every part", () => {
    const counts: Partial<Record<PromoPart, number>> = {};
    for (const note of score.notes) {
      counts[note.inst] = (counts[note.inst] || 0) + 1;
    }
    expect(counts).toEqual(PYTHON_NOTE_COUNTS);
    expect(score.notes).toHaveLength(559);

    const of = (inst: PromoPart) => score.notes.filter((n) => n.inst === inst);
    // the aria: A5 D6 F6 ... (Python names; MIDI 69 74 77) starting at bar 16
    const row = (n: { t: number; midi: number; dur: number; vel: number }) => [
      ms(n.t),
      n.midi,
      ms(n.dur),
      n.vel,
    ];
    expect(of("voice").slice(0, 3).map(row)).toEqual([
      [38.4, 69, 0.6, 1],
      [39, 74, 0.6, 1],
      [39.6, 77, 1.2, 1],
    ]);
    // the lead motif enters at bar 10 on D6 (MIDI 74)
    expect(row(of("lead")[0])).toEqual([24, 74, 0.45, 0.9]);
    // the bass ostinato: D2 (MIDI 38) at 0, 3, 6, 8 ... with the 2-step accents on the beats
    expect(of("bass").slice(0, 4).map(row)).toEqual([
      [14.4, 38, 0.3, 1],
      [14.85, 38, 0.225, 0.75],
      [15.3, 38, 0.225, 0.75],
      [15.6, 38, 0.3, 1],
    ]);
    // the sub drone (Python D2, 73 Hz) is held from bar 0 step 4 right through to the title hit
    expect(row(of("sub")[0])).toEqual([0.6, 38, 9, 0.9]);
  });

  it("raises the same picture cues the Python score did", () => {
    const kinds: Record<string, number> = {};
    for (const e of score.events) {
      kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    }
    expect(kinds).toEqual(PYTHON_EVENT_COUNTS);
    expect(
      score.events.filter((e) => e.kind === "hit").map((e) => e.t),
    ).toEqual([9.6, 45.6]);
    // the snare roll in bar 15 has no clap under it and therefore no cue
    expect(
      score.events.filter((e) => e.kind === "snare" && e.t >= 36 && e.t < 38.4),
    ).toHaveLength(0);
    expect(
      Object.fromEntries(
        Object.entries(score.sections).map(([k, [a, b]]) => [
          k,
          [ms(a), ms(b)],
        ]),
      ),
    ).toEqual({
      noise: [0, 4.8],
      carve: [4.8, 9.6],
      title: [9.6, 14.4],
      features: [14.4, 33.6],
      break: [33.6, 38.4],
      climax: [38.4, 45.6],
      outro: [45.6, 50.4],
    });
    expect(Object.keys(PROMO_CHAPTERS)).toEqual(Object.keys(score.sections));
  });

  it("carries the patches into the score for the scope overlays", () => {
    expect(Object.keys(score.instruments).sort()).toEqual(
      Object.keys(PROMO_ID).sort(),
    );
    expect(score.instruments.voice).toMatchObject({
      name: "Vocals/Soprano (ah)",
      params: { f1: 800, f2: 1150, f3: 2900 },
    });
    expect(score.instruments.kick!.voiceGain).toBeCloseTo(
      0.9 * score.instruments.kick!.params.gain,
      9,
    );
  });

  it("keeps the intro, groove, break, climax, and final hit editable as named sections", () => {
    const patternsAt = (step: number) =>
      promo.arrangement
        .filter((clip) => clip.start === step)
        .map(
          (clip) =>
            promo.patterns.find((pattern) => pattern.id === clip.patternId)
              ?.name,
        );

    expect(patternsAt(0)).toEqual(
      expect.arrayContaining([
        "01 Intro/noise swell — FX & Impacts",
        "01 Intro/noise swell — Low End",
      ]),
    );
    expect(patternsAt(96)).toContain("04 Groove/d minor pulse — Drums");
    expect(patternsAt(224)).toContain("12 Break/floor drops — FX & Impacts");
    expect(patternsAt(256)).toContain("13 Climax/d minor lift — Soprano");
    expect(patternsAt(304)).toContain("16 Outro/final hit — FX & Impacts");
    expect(promo.tracks.map((track) => track.name)).toEqual([
      "01 FX & Impacts",
      "02 Drums",
      "03 Low End",
      "04 Harmony",
      "05 Arpeggio",
      "06 Lead",
      "07 Soprano",
    ]);
    // every clip is its own pattern: nothing is shared, nothing overlaps on a lane
    expect(new Set(promo.arrangement.map((c) => c.patternId)).size).toBe(
      promo.arrangement.length,
    );
    for (const a of promo.arrangement) {
      for (const b of promo.arrangement) {
        if (a !== b && a.track === b.track) {
          expect(a.start >= b.start + b.len || b.start >= a.start + a.len).toBe(
            true,
          );
        }
      }
    }
  });

  it("rides the master the way the trailer did: whisper, swell, hit, break, climax", () => {
    const vol = promo.automation?.find(
      (lane) => lane.target === "master" && lane.param === "vol",
    );
    const at = (step: number) =>
      vol!.points.find((p) => p.step === step)!.value;
    const full = at(64);
    const db = (v: number) => 20 * Math.log10(v / full);
    expect(db(at(0))).toBeCloseTo(-11, 0); // whisper
    expect(db(at(32))).toBeCloseTo(-6, 0); // swell
    expect(db(at(63))).toBeCloseTo(-3, 0); // ... into the title hit
    expect(db(at(226))).toBeCloseTo(-3, 0); // the break drops 3 dB
    expect(at(256)).toBe(full); // the climax opens it up again
    // The normal master limiter absorbs transient peaks without turning down the whole song.
    expect(full).toBeLessThan(0.5);
    expect(full).toBeCloseTo(0.34, 3);
    expect(promo.mixer?.master).toMatchObject({ limiter: true, ceilingDb: -1 });
    expect(
      promo.automation?.find((lane) => lane.param === "rev")?.points[0].value,
    ).toBeCloseTo(0.74, 6);
  });
});
