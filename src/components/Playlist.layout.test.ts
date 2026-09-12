import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { ifConditionForElement } from "../test/svelte-semantics";

const playlist = readFileSync(
  fileURLToPath(new URL("./Playlist.svelte", import.meta.url)),
  "utf8",
);

describe("Playlist frozen track labels", () => {
  it("shows only bar numbers in the ruler, with meter detail in the tooltip", () => {
    expect(playlist).toContain(
      "title={`Bar ${bar.bar} · ${bar.numerator}/${bar.denominator} · step ${bar.start}`}",
    );
    expect(playlist).not.toContain(
      "<span>{bar.numerator}/{bar.denominator}</span>",
    );
  });

  it("keeps all markers scrollable without extending the musical arrangement", () => {
    const expression = playlist.match(
      /const totalLength\s*=\s*\$derived\(\s*([\s\S]*?\)\s*\+\s*64)\s*,?\s*\);/,
    )?.[1];
    expect(expression).toBeTruthy();
    for (const kind of ["tempos", "meters", "sections"]) {
      const p = {
        arrangement: [{ start: 0, len: 96 }],
        conductor: {
          tempos: [],
          meters: [],
          sections: [],
          [kind]: [{ step: 1000000 }],
        },
      };
      const before = JSON.stringify(p);
      expect(runInNewContext(expression!, { $project: p })).toBe(1000064);
      expect(JSON.stringify(p)).toBe(before);
    }
    expect(runInNewContext(expression!, { $project: null })).toBe(192);
  });

  it("aligns conductor, ruler and clips using one scroll coordinate and viewport width", () => {
    expect(playlist).toContain("grid-template-rows: 24px 28px minmax(0, 1fr)");
    expect(playlist).toMatch(/\.frozen-track-labels\s*\{[^}]*grid-row:\s*3;/s);
    expect(playlist).toMatch(/\.grid-viewport\s*\{[^}]*grid-row:\s*3;/s);
    expect(playlist).toContain("bind:clientWidth={viewportWidth}");
    expect(playlist).toMatch(
      /<Conductor[\s\S]*?\{cellWidth}[\s\S]*?\{scrollLeft}[\s\S]*?\{totalLength}[\s\S]*?\{viewportWidth}/,
    );
    expect(playlist).toContain(
      'style="max-width: {viewportWidth}px;" class="timeline-viewport"',
    );
    expect(playlist).toContain("background-size: var(--cell-width) 100%");
    expect(playlist).toContain("{#each visibleBars as bar (bar.start)}");
  });

  it("keeps labels outside the horizontally scrolling grid pane", () => {
    expect(playlist).toMatch(/class="frozen-track-labels"/);
    expect(playlist).toMatch(/class="grid-viewport"/);
    expect(playlist).toMatch(/\.playlist-scroll\s*\{[^}]*overflow:\s*hidden;/s);
    expect(playlist).toMatch(/\.grid-viewport\s*\{[^}]*overflow:\s*auto;/s);
  });

  it("keeps selected-clip controls within the arranger width", () => {
    expect(playlist).toMatch(/\.playlist-container\s*\{[^}]*min-width:\s*0;/s);
    expect(playlist).toMatch(/\.clip-tools\s*\{[^}]*overflow-x:\s*auto;/s);
  });

  it("offers per-instance clip level controls and marks attenuated clips", () => {
    expect(playlist).toContain("function adjustClipGain(delta: number)");
    expect(playlist).toContain("function setClipGainPercent(value: number)");
    expect(playlist).toContain(
      "onclick={() => adjustClipGain(-CLIP_GAIN_STEP)}",
    );
    expect(playlist).toContain(
      "onclick={() => adjustClipGain(CLIP_GAIN_STEP)}",
    );
    expect(playlist).toContain("onclick={resetClipGain}");
    expect(playlist).toContain('class="clip-gain"');
  });

  it("lets selected clip pitch modifiers and level be entered directly", () => {
    expect(playlist).toContain("function setClipTranspose(value: number)");
    expect(playlist).toContain("function setClipPartial(value: number)");
    expect(playlist).toContain(
      'aria-label="Transpose selected clips in semitones"',
    );
    expect(playlist).toContain(
      'aria-label="Harmonic multiplier for selected clips"',
    );
    expect(playlist).toContain(
      'aria-label="Level for selected clips as a percent"',
    );
    expect(playlist).toContain('class="clip-tool-group"');
    expect(playlist).toContain(".clip-tool-group + .clip-tool-group");
  });

  it("keeps semitone transposition primary and reveals optional harmonic partials", () => {
    expect(playlist).toContain("function adjustClipPartial(delta: number)");
    expect(playlist).toContain("let showPartialControls = $state(false)");
    expect(playlist).toContain(
      "showPartialControls || hasPartialMultiplier(selectedClips[0])",
    );
    expect(playlist).toContain(
      'title="Show exact harmonic multiplier controls"',
    );
    expect(playlist).toContain("transposeClips(delta);");
    expect(playlist).toContain('class="clip-transpose"');
  });

  it("keeps song orientation visible by identifying all uses of the open pattern", () => {
    expect(playlist).toContain("currentPatternClips");
    expect(playlist).toContain("currentPatternLocations");
    expect(playlist).toContain('class="pattern-usage"');
    expect(playlist).toContain(
      "class:open-pattern={clip.patternId === $selPatId}",
    );
    expect(playlist).toMatch(/\.clip\.open-pattern\s*\{[\s\S]*box-shadow:/);
  });

  it("keeps the song playhead visible while playback advances", () => {
    expect(playlist).toContain("function scrollPlayheadIntoView");
    expect(playlist).toContain(
      "scrollPlayheadIntoView(playlistEl, $curStep, cellWidth)",
    );
  });

  it("hides the arranger playhead while previewing one pattern", () => {
    const condition = ifConditionForElement(playlist, "div", "playhead");

    expect(condition?.identifiers).toEqual(
      expect.arrayContaining(["$playing", "$playMode"]),
    );
    expect(condition?.strings).toContain("song");
  });

  it("uses the timeline corner for the automation action and retains a stable selection toolbar", () => {
    expect(playlist).toContain('aria-label="Add track"');
    expect(playlist).toMatch(
      /class="corner frozen-corner"[\s\S]*aria-label="Add automation lane"/,
    );
    expect(playlist).toContain('class="playlist-header"');
    expect(playlist).toMatch(
      /\{#if selectedClips\.length}[\s\S]*class="clip-tools"/,
    );
    expect(playlist).toMatch(/\.playlist-header\s*\{[^}]*height:\s*40px;/s);
    expect(playlist).toMatch(
      /class="playlist-footer">[\s\S]*Click an empty lane to clear the selection/,
    );
  });

  it("coordinates one selected automation point and popup across all lanes", () => {
    expect(playlist).toMatch(
      /let selectedAutomationPoint:\s*\{\s*laneId: string;\s*point: AutomationPoint\s*}\s*\| null\s*= \$state\(null\)/,
    );
    expect(playlist).toMatch(
      /selectedPoint=\{selectedAutomationPoint\?\.laneId\s*===\s*lane\.id\s*\?\s*selectedAutomationPoint\.point\s*:\s*null}/,
    );
    expect(playlist).toContain("hasSelectedPoint={!!selectedAutomationPoint}");
    expect(playlist).toContain("editorKey={`automation:${lane.id}`}");
    expect(playlist).toContain("bind:contextualEditor");
  });

  it("keeps complete automation target and parameter names readable in the frozen labels", () => {
    expect(playlist).toContain(
      'class="auto-name" title={laneTitle($project!, lane)}',
    );
    expect(playlist).toContain('class="auto-target"');
    expect(playlist).toContain('class="auto-param"');
    expect(playlist).toMatch(
      /\.auto-label \.auto-name\s*\{[^}]*flex-direction:\s*column;/s,
    );
  });

  it("clears clip selection before an automation lane can edit points", () => {
    expect(playlist).toContain(
      "canEdit={shouldEditAutomation(selectedClips.length > 0)}",
    );
    expect(playlist).toContain("onblocked={clearSelection}");
  });

  it("clears a selected automation point before placing a pattern clip", () => {
    expect(playlist).toContain("if (selectedAutomationPoint)");
    expect(playlist).toContain("selectAutomationPoint(null, null);");
    const placement = [
      ...playlist.matchAll(
        /const found\s*=\s*\$project\.arrangement\.find\(\s*c\s*=>\s*c\.track\s*===\s*t/g,
      ),
    ].at(-1)?.index;

    expect(placement).toBeGreaterThan(-1);
    expect(playlist.indexOf("selectAutomationPoint(null, null);")).toBeLessThan(
      placement!,
    );
  });

  it("renders automation lanes as draggable rows that can occupy track slots", () => {
    expect(playlist).toContain("$project.automationPositions");
    expect(playlist).toContain("const arrangerRows = $derived");
    expect(playlist).toContain('draggable="true"');
    expect(playlist).toMatch(
      /startAutomationDrag\(event(?: as DragEvent)?, lane\)/,
    );
    expect(playlist).toMatch(
      /dropAutomationLane\(event(?: as DragEvent)?, lane\)/,
    );
    expect(playlist).toContain("rowTopForTrack(clip.track)");
  });

  it("uses mixed row heights for clips and selections beside automation lanes", () => {
    expect(playlist).toContain(
      "function rowTopForTrack(trackIndex: number): number",
    );
    expect(playlist).toMatch(
      /top:\s*\{rowTopForTrack\(clip\.track\)\s*\+\s*2}px;/,
    );
    expect(playlist).toContain(
      "top: Math.min(rowTopForTrack(selectionStart.t), rowTopForTrack(selectionEnd.t))",
    );
  });

  it("shows a shared insertion indicator while dragging arranger rows", () => {
    expect(playlist).toContain(
      "let dragInsertionRow: number | null = $state(null)",
    );
    expect(playlist).toContain("function updateDragInsertion");
    expect(playlist).toContain("function rowBoundaryTop");
    expect(playlist).toContain('class="drop-indicator"');
    expect(playlist).toContain(
      'style="top: {rowBoundaryTop(dragInsertionRow)}px;"',
    );
    expect(playlist).toMatch(
      /\.drop-indicator\s*\{[^}]*pointer-events:\s*none;[^}]*background:\s*var\(--action\);/s,
    );
  });

  it("offers guarded lane removal beside the existing track controls", () => {
    expect(playlist).toContain('aria-label="Remove track"');
    expect(playlist).toContain('class="auto-label track-label"');
    expect(playlist).toMatch(
      /<button\b(?=[^>]*\bclass="ms remove-track")(?=[^>]*\baria-label="Remove automation lane")[^>]*>/,
    );
    expect(playlist).toContain("requestRemoveAutoLane(lane)");
    expect(playlist).toContain("let showRemoveAutoLane = $state(false)");
    expect(playlist).toContain("import Confirm from './ui/Confirm.svelte'");
    expect(playlist).toContain('title="Remove Automation Lane"');
    expect(playlist).toContain("bind:show={showRemoveAutoLane}");
    expect(playlist).toContain('confirmLabel="Remove lane"');
    expect(playlist).toContain("onconfirm={removeAutoLane}");
    expect(playlist).toContain("showRemoveTrack");
    expect(playlist).toContain('confirmLabel="Remove track"');
    expect(playlist).toContain("onconfirm={removeTrack}");
    expect(playlist).toMatch(
      /removeArrangementTrack\(\s*\$project\.tracks,\s*\$project\.arrangement,\s*trackToRemove,?\s*\)/,
    );
  });

  it("shows square left-edge insertion controls at every track divider and supports lane drag reordering", () => {
    expect(playlist).toContain('class="track-divider top-track-divider"');
    expect(playlist).toContain(
      "onclick={stopPropagation(() => insertTrack(0))}",
    );
    expect(playlist).toContain('aria-label="Insert track"');
    expect(playlist).toContain('class="track-insert"');
    expect(playlist).toMatch(
      /\.track-divider:hover::before[^}]*border-color:\s*var\(--action\)/s,
    );
    expect(playlist).toMatch(/\.track-insert\s*\{[^}]*border-radius:\s*3px;/s);
    expect(playlist).toMatch(/\.track-insert\s*\{[^}]*left:\s*6px;/s);
    expect(playlist).toMatch(/\.track-insert\s*\{[^}]*padding:\s*0;/s);
    expect(playlist).toMatch(/\.track-insert\s*\{[^}]*place-items:\s*center;/s);
    expect(playlist).toMatch(/\.track-divider\s*\{[^}]*top:\s*-9px;/s);
    expect(playlist).toMatch(/\.track-divider::before\s*\{[^}]*top:\s*50%;/s);
    expect(playlist).toMatch(
      /\.track-insert\s*\{[^}]*background:\s*var\(--action\);/s,
    );
    expect(playlist).toMatch(
      /\.track-insert:focus-visible\s*\{[^}]*opacity:\s*1;/s,
    );
    expect(playlist).toContain(
      ".track-divider:has(:global(.track-insert:focus-visible))::before",
    );
    expect(playlist).not.toContain(".track-divider:focus-within::before");
    expect(playlist).not.toContain(".track-divider:focus-within .track-insert");
    expect(playlist).toContain('draggable="true"');
    expect(playlist).toMatch(
      /ondragstart=\{\(?event\)?\s*=>\s*startTrackDrag\(event(?: as DragEvent)?, t\)}/,
    );
    expect(playlist).toMatch(
      /ondrop=\{\(?event\)?\s*=>\s*dropTrack\(event(?: as DragEvent)?, t\)}/,
    );
    expect(playlist).toMatch(
      /\.track-divider\s*\{[^}]*pointer-events:\s*none;/s,
    );
    expect(playlist).toMatch(
      /\.track-divider:hover \.track-insert[\s\S]*pointer-events:\s*auto;/s,
    );
  });
});
