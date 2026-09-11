import { describe, expect, it, vi } from "vitest";

import { buildDemoProject, isProject } from "./project";
import { barAt, barsInRange, createTimingMap, isConductorData } from "./timing";
import { songLengthSteps } from "./transport";
import { placeSections, WINTER_MOVEMENTS } from "./winter-demo";

vi.mock("./engine", () => ({}));

describe("demo conductor scores", () => {
  it("labels Monsoon’s actual 7/8 bars and preserves the taiko polymeter inside 4/4", () => {
    const p = buildDemoProject("monsoon");
    expect(isProject(p)).toBe(true);
    expect(isConductorData(p.conductor)).toBe(true);
    const sections = p.conductor!.sections;
    const seven = sections.find(
      (section) => section.name === "Seven Rains",
    )!.step;
    const storm = sections.find((section) => section.name === "Storm")!.step;
    expect([seven, storm]).toEqual([384, 608]);
    const bars = barsInRange(p, seven, storm);
    expect(bars).toHaveLength(16);
    expect(
      bars.every(
        (bar) =>
          bar.end - bar.start === 14 &&
          bar.numerator === 7 &&
          bar.denominator === 8,
      ),
    ).toBe(true);
    expect(barAt(p, storm)).toMatchObject({
      bar: 41,
      numerator: 4,
      denominator: 4,
    });
    const hemiola = p.patterns.find((pattern) => pattern.steps === 12)!;
    const clip = p.arrangement.find((clip) => clip.patternId === hemiola.id)!;
    expect(clip.len).toBe(96);
    expect(barAt(p, clip.start)).toMatchObject({
      numerator: 4,
      denominator: 4,
    });
  });

  it("gives Monsoon a restrained tempo arc, leaving clips and automation anchored to musical time", () => {
    const p = buildDemoProject("monsoon"),
      timing = createTimingMap(p);
    expect(timing.bpmAt(0)).toBe(84);
    expect(timing.bpmAt(128)).toBe(88);
    expect(timing.bpmAt(400)).toBe(88);
    expect(timing.bpmAt(700)).toBe(90);
    expect(timing.bpmAt(1055)).toBe(82);
    const length = songLengthSteps(p);
    expect(length).toBe(1056);
    expect(timing.secondsAt(length)).toBeGreaterThan(175);
    expect(timing.secondsAt(length)).toBeLessThan(190);
    expect(
      p.automation!.every((lane) =>
        lane.points.every((point) => point.step <= length),
      ),
    ).toBe(true);
    expect(p.conductor!.sections.map((section) => section.name)).toEqual([
      "Rain",
      "Bronze",
      "Seven Rains",
      "Storm",
      "Eye of the storm",
      "Storm returns",
      "After",
    ]);
  });

  it("makes every Winter section navigable without altering its established performance timing", () => {
    const p = buildDemoProject("winter"),
      placed = placeSections();
    expect(isProject(p)).toBe(true);
    expect(p.conductor!.sections).toHaveLength(placed.length);
    expect(p.conductor!.tempos).toEqual([]);
    expect(p.conductor!.meters).toEqual([]);
    p.conductor!.sections.forEach((marker, i) => {
      expect(marker.step).toBe(placed[i].start);
      expect(marker.name).toContain(
        WINTER_MOVEMENTS[placed[i].movement].data.title,
      );
      expect(p.arrangement.some((clip) => clip.start === marker.step)).toBe(
        true,
      );
    });
    expect(createTimingMap(p).secondsAt(songLengthSteps(p))).toBeCloseTo(
      (songLengthSteps(p) * 60) / p.bpm / 4,
      10,
    );
    expect(buildDemoProject("promo").conductor).toBeUndefined();
  });
});
