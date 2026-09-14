import { describe, expect, it } from "vitest";

import {
  componentFunction,
  componentMarkup,
  components,
  componentSource,
  elements,
  functionHasCall,
  hasAttribute,
  styleRules,
} from "../test/svelte-semantics";

const sequencer = componentSource(
  new URL("./Sequencer.svelte", import.meta.url),
);

describe("Sequencer note interactions", () => {
  it("edits all selected note properties in a persistent sidebar", () => {
    expect(sequencer).not.toContain("function openNoteEditor");
    expect(sequencer).not.toContain('class="note-editor"');
    expect(sequencer).not.toContain("ondblclick=");
    expect(sequencer).toContain('class="note-inspector"');
    expect(sequencer).toContain('aria-label="Selected note properties"');
    expect(sequencer).toContain('type="range"');
    expect(sequencer).toContain('aria-label="Selected notes velocity"');
    expect(sequencer).toMatch(
      /max="100"[\s\S]*min="1"[\s\S]*updateSelectedVelocity/,
    );
    expect(sequencer).toContain('class="note-overrides"');
    expect(sequencer).toContain(
      'aria-label="Instrument parameter to override"',
    );
    expect(sequencer).toContain("function addSelectedNoteOverride()");
    expect(sequencer).toContain(
      "function updateSelectedNoteOverride(param: string, value: number)",
    );
    expect(sequencer).toContain(
      "placeholder={value === null ? 'Mixed' : undefined}",
    );
  });

  it("records the selected notes before starting an Alt-drag velocity edit", () => {
    expect(sequencer).toMatch(
      /if \(e\.altKey && found\) \{[\s\S]*dragTargets = notes\.filter\(n => n\.selected\) as ExtendedNote\[\];[\s\S]*velMode = true;/,
    );
    expect(sequencer).toMatch(
      /if \(velMode && dragNote\) \{[\s\S]*const targetNotes = draggedNotes\(\);[\s\S]*replaceEditedNotes\(targetNotes\);/,
    );
  });

  it("marks notes with parameter overrides without changing their note content", () => {
    expect(sequencer).toContain("class:has-overrides=");
    expect(sequencer).toContain(".note.has-overrides");
  });

  it("keeps the pattern editor header from forcing a wider panel", () => {
    const markup = componentMarkup(sequencer);
    const styles = styleRules(sequencer);

    expect(components(markup, "PatternBar")).toHaveLength(0);
    expect(
      elements(markup, "div").some((element) =>
        hasAttribute(element, "class", "editor-toolbar"),
      ),
    ).toBe(true);
    expect(
      elements(markup, "span").some((element) =>
        hasAttribute(element, "class", "toolbar-hint"),
      ),
    ).toBe(true);
    expect(
      elements(markup, "button").some((element) =>
        hasAttribute(element, "class", "instrument-edit"),
      ),
    ).toBe(true);
    expect(styles.get(".toolbar-row")?.get("grid-template-columns")).toBe(
      "minmax(0, 1fr) auto",
    );
    expect(styles.get(".toolbar-hint")?.get("text-align")).toBe("center");
    expect(styles.get(".piano-roll-container")?.get("min-width")).toBe("0");
  });

  it("fills the pattern pane and exposes a compact focus-mode control", () => {
    const markup = componentMarkup(sequencer);
    const styles = styleRules(sequencer);

    expect(styles.get(".piano-roll")?.get("flex")).toBe("1");
    expect(styles.get(".piano-roll")?.get("height")).toBe("auto");
    expect(sequencer).not.toContain("height: clamp(180px, 30vh, 340px)");
    expect(
      elements(markup, "button").some((element) =>
        hasAttribute(element, "class", "pattern-focus"),
      ),
    ).toBe(true);
    expect(sequencer).toContain("onToggleFocus");
    expect(sequencer).toContain("patternFocused");
  });

  it("keeps step numbers vertically centered and note bodies free of repeated pitch labels", () => {
    const styles = styleRules(sequencer);

    expect(styles.get(".time-marker")?.get("display")).toBe("flex");
    expect(styles.get(".time-marker")?.get("align-items")).toBe("center");
    expect(styles.get(".time-marker")?.get("padding")).toBe("0 4px");
    expect(sequencer).not.toMatch(/class="note"[\s\S]*?>\s*\{n\.pitch\}/);
  });

  it("uses a draggable timeline end handle for pattern length", () => {
    expect(sequencer).toMatch(
      /class="length-counter"\s*aria-label="Pattern length"/,
    );
    expect(sequencer).toContain('class="pattern-end-handle"');
    expect(sequencer).toContain("function startPatternResize");
    expect(sequencer).toContain("function handlePatternResize");
    expect(sequencer).toMatch(/aria-valuemax="512"[\s\S]*aria-valuemin="1"/);
    expect(sequencer).toContain(
      "setPatternSteps((event.clientX - rect.left) / cellWidth)",
    );
    expect(sequencer).toMatch(
      /\?\s*\{\s*\.\.\.pattern,\s*steps:\s*nextSteps,\s*tracks\s*\}/,
    );
    expect(sequencer).not.toContain("pat.steps = nextSteps;");
    expect(sequencer).not.toContain("Shorten pattern by four steps");
    expect(sequencer).not.toContain("Extend pattern by four steps");
    expect(sequencer).toMatch(/\.corner\s*\{[^}]*width:\s*88px;/s);
    expect(sequencer).toMatch(/\.side-bar\s*\{[^}]*width:\s*88px;/s);
  });

  it("draws legato links with their selected transition curve", () => {
    expect(sequencer).toContain("function legatoPath");
    expect(sequencer).toContain("segmentProgress(glide.curve, t)");
    expect(sequencer).toContain("d={legatoPath(line.source, line.target)}");
    expect(sequencer).toMatch(/\.legato-line\s*\{[^}]*fill:\s*none;/s);
    expect(sequencer).not.toContain('<line class="legato-line"');
  });

  it("draws the portamento curve from the source end to the target start", () => {
    expect(sequencer).toMatch(
      /legatoTransition\(\s*source,\s*target\.start,\s*stepDuration/,
    );
    expect(sequencer).toContain("sourceX + (targetX - sourceX) * t");
    expect(sequencer).not.toContain("target.start + glide.time / stepDuration");
  });

  it("offers pitch-slide controls only for a sequential selected note set", () => {
    expect(sequencer).toContain("const selectedLegatoSequence = $derived.by");
    expect(sequencer).toContain(
      "isLegatoTarget(sequence[index - 1], note.start)",
    );
    expect(sequencer).toContain('class="note-legato-actions"');
    expect(sequencer).toContain("const selectedLegatoJoins = $derived");
    expect(sequencer).toContain("const selectedLegatoCanConnect = $derived");
    expect(sequencer).toContain("selectedLegatoCurve !== 'mixed'");
    expect(sequencer).toContain("selectionKey: selectedLegatoSelectionKey");
    expect(sequencer).toContain(
      "selectedLegatoCurveChoice?.selectionKey === selectedLegatoSelectionKey",
    );
    expect(sequencer).toContain("dragLegatoTargets = new Map");
    expect(sequencer).toMatch(
      /updateLegatoTargets\(notes,\s*originalPositions,\s*dragLegatoTargets\)/,
    );
  });

  it("selects a newly added note before using it as the active drag target", () => {
    expect(sequencer).toMatch(
      /const newNote: ExtendedNote = \{\s*pitch:\s*ROW_NOTES\[r\]\.name,\s*start:\s*s,\s*len:\s*1,\s*selected:\s*true,?\s*\};/,
    );
  });

  it("replaces the current instrument track when adding a note so the roll redraws", () => {
    expect(sequencer).toMatch(
      /const track = \[\s*\.\.\.\(pat\.tracks\[\$selInstId\] \?\? \[\]\),\s*newNote,?\s*\];/,
    );
    expect(sequencer).toContain("pat.tracks[$selInstId] = track;");
    expect(sequencer).toMatch(
      /dragNote = pat\.tracks\[\$selInstId\]\[track\.length - 1\] as ExtendedNote;/,
    );
    expect(sequencer).not.toContain("notes.push(newNote);");
  });

  it("replaces dragged and resized notes so their updated geometry redraws immediately", () => {
    expect(sequencer).toContain("function replaceEditedNotes");
    expect(sequencer).toContain("function draggedNotes");
    expect(sequencer).toContain("let dragTargets: ExtendedNote[] = [];");
    expect(sequencer).toContain("return dragTargets;");
    expect(sequencer).toContain("const track = pat.tracks[$selInstId] ?? [];");
    expect(sequencer).toMatch(
      /pat\.tracks\[\$selInstId\] = track\.map\(note => replacements\.get\(note\) \?\? note\);/,
    );
    expect(sequencer).toMatch(
      /dragTargets = dragTargets\.map\(note => replacements\.get\(note\) \?\? note\);/,
    );
    expect(sequencer).toMatch(
      /const targetNotes = draggedNotes\(\);[\s\S]*replaceEditedNotes\(targetNotes\)[\s\S]*dragNote = replacements\.get\(dragNote\) \?\? dragNote;/,
    );
  });

  it("keeps a newly placed note as the active drag target until mouse-up", () => {
    expect(sequencer).toMatch(
      /const newNote: ExtendedNote = \{\s*pitch:\s*ROW_NOTES\[r\]\.name,\s*start:\s*s,\s*len:\s*1,\s*selected:\s*true,?\s*\};[\s\S]*dragNote = pat\.tracks\[\$selInstId\]\[track\.length - 1\] as ExtendedNote;[\s\S]*beginNoteDrag\(dragNote, r, s, s_raw\);/,
    );
    expect(sequencer).toMatch(/dragNote = null;\s*dragTargets = \[\];/);
  });

  it("clears a note selection before a plain empty-cell click can add a note", () => {
    expect(sequencer).toContain(
      "shouldPlaceNote(selectedNotes.length > 0, e.shiftKey)",
    );
    expect(sequencer).toMatch(
      /if \(!shouldPlaceNote\(selectedNotes\.length > 0, e\.shiftKey\)\) \{\s*clearSelection\(\);\s*return;\s*\}[\s\S]*const newNote: ExtendedNote/,
    );
  });

  it("edits and removes sequential pitch slides from the selected-note sidebar", () => {
    expect(sequencer).toContain("function removeLegato");
    expect(
      functionHasCall(sequencer, "removeLegato", "commitCurrentTrack"),
    ).toBe(true);
    expect(sequencer).toMatch(
      /aria-label="Remove pitch slides"[\s\S]*onclick=\{removeLegato\}[\s\S]*<i class="fa fa-link-slash" aria-hidden="true"><\/i>/,
    );
    expect(sequencer).toMatch(
      /aria-label="Create missing pitch slides"[\s\S]*disabled=\{!selectedLegatoCanConnect\}[\s\S]*onclick=\{addLegato\}/,
    );
    expect(sequencer).toContain(
      '<option disabled value="mixed">Mixed</option>',
    );
    expect(sequencer).toMatch(
      /aria-label="Create missing pitch slides"[\s\S]*<i class="fa fa-link" aria-hidden="true"><\/i>/,
    );
    expect(sequencer).not.toContain("</i> Connect");
    expect(sequencer).not.toContain("</i> Remove slides");
    expect(sequencer).not.toContain("<span>Type</span>");
    expect(sequencer).not.toContain("Move pitch to second note");
  });

  it("initializes each movable note drag from the current track and auditions it immediately", () => {
    expect(sequencer).toContain("function beginNoteDrag");
    expect(sequencer).toMatch(
      /const targetNotes = note\.selected\s*\?[\s\S]*pat\.tracks\[\$selInstId\][\s\S]*filter\(current => current\.selected\)[\s\S]*:\s*\[note\];/,
    );
    expect(sequencer).toMatch(
      /dragTargets = targetNotes;[\s\S]*void previewDraggedNote\(note\);/,
    );
    expect(sequencer).toMatch(/beginNoteDrag\(found, r, s, s_raw\);/);
    expect(sequencer).toMatch(/beginNoteDrag\(dragNote, r, s, s_raw\);/);
  });

  it("uses the immutable shared deletion operation for right-drag deletion", () => {
    expect(sequencer).toContain("deleteNotes,");
    expect(sequencer).toMatch(
      /function deleteNoteAt[\s\S]*if \(found\) \{\s*deleteNotes\(\[found\]\);/,
    );
  });

  it("keeps selection as local view state while committing note content edits", () => {
    expect(sequencer).toMatch(
      /function commitCurrentTrack\(\)[\s\S]*pat\.tracks\[\$selInstId\] = \[\.\.\.\(pat\.tracks\[\$selInstId\] \?\? \[\]\)\];/,
    );
    expect(sequencer).toContain("let selectionRevision = $state(0);");
    expect(sequencer).toContain("selectionRevision++;");
    expect(sequencer).toContain("const displayedNotes = $derived.by");
    expect(functionHasCall(sequencer, "addLegato", "commitCurrentTrack")).toBe(
      true,
    );
  });

  it("replaces selection-changed notes so their selected border follows the logical selection", () => {
    expect(sequencer).toContain("function updateNoteSelection");
    expect(sequencer).toContain("function selectOnlyNote");
    expect(sequencer).toMatch(
      /function clearSelection\(\)[\s\S]*updateNoteSelection\(\(?note\)? => \(?note\.selected \? false : note\.selected\)?\);/,
    );
    expect(sequencer).toMatch(
      /function selectOnlyNote\(note: ExtendedNote\)[\s\S]*updateNoteSelection\(\(?current\)? => current === note\);/,
    );
    expect(sequencer).toContain("class:selected={selectedNotes.includes(n)}");
  });

  it("measures drag coordinates against the scrolled grid background", () => {
    expect(sequencer).toContain("function gridPositionAt");
    expect(sequencer).toContain("rollEl.querySelector('.grid-container')");
    expect(sequencer).toMatch(
      /handleMouseDown\(mouseEvent, gridPosition\.r, gridPosition\.s\);/,
    );
  });

  it("retunes the held preview voice whenever a dragged note changes pitch", () => {
    expect(sequencer).toContain("const DRAG_PREVIEW_TRACK = 'drag-preview'");
    expect(sequencer).toContain("function previewDraggedNote");
    expect(sequencer).toContain("const pitch = note.pitch;");
    expect(sequencer).toContain("const velocity = note.vel ?? 1;");
    expect(functionHasCall(sequencer, "previewDraggedNote", "glideAt")).toBe(
      true,
    );
    expect(sequencer).toContain(
      "let activePreviewPitch: string | null = null;",
    );
    expect(sequencer).toContain("const previousPitch = activePreviewPitch;");
    expect(sequencer).toContain("lastPlayedPitch.set(pitch);");
    expect(sequencer).toContain(
      "glideAt(DRAG_PREVIEW_TRACK, previousPitch, pitch, 0, 0.015)",
    );
    expect(functionHasCall(sequencer, "previewDraggedNote", "noteOff")).toBe(
      true,
    );
    expect(sequencer).toContain(
      "noteOnAt(DRAG_PREVIEW_TRACK, pitch, 0, selectedInstrument().params, velocity);",
    );
    expect(sequencer).toContain("activePreviewPitch = pitch;");
    expect(sequencer).toContain("previewDraggedNote(dragNote);");
    expect(sequencer).toContain("function stopDragPreview");
    expect(sequencer).toContain("stopDragPreview();");
  });

  it("follows the active pattern playhead and hides song playback outside the open pattern", () => {
    const playheadStep = (playing: boolean, mode: string, curStep: number) =>
      componentFunction<() => number[]>(sequencer, "patternPlayheadSteps", {
        $playing: playing,
        $playMode: mode,
        $curStep: curStep,
        $project: { arrangement: [], tracks: [] },
        pat: { id: "pattern" },
        steps: 16,
      })();

    expect(sequencer).toContain("playMode");
    expect(sequencer).toContain("function patternPlayheadSteps");
    expect(sequencer).toContain("if ($playMode === 'pattern')");
    expect(playheadStep(true, "pattern", 19)).toEqual([3]);
    expect(playheadStep(true, "preview", 19)).toEqual([]);
    expect(sequencer).toMatch(
      /scrollPlayheadIntoView\(rollEl,\s*currentPatternPlayheadStep,\s*cellWidth,\s*88\)/,
    );
    expect(sequencer).toContain("{#if currentPatternPlayheadStep !== null}");
  });

  it("shows every active position of the open pattern during overlapping song clips", () => {
    const playheadSteps = componentFunction<() => number[]>(
      sequencer,
      "patternPlayheadSteps",
      {
        $playing: true,
        $playMode: "song",
        $curStep: 12,
        $project: {
          tracks: [{}, {}],
          arrangement: [
            { patternId: "pattern", start: 0, len: 16, track: 0 },
            { patternId: "pattern", start: 8, len: 16, track: 1 },
          ],
        },
        pat: { id: "pattern" },
        steps: 16,
      },
    );

    expect(playheadSteps()).toEqual([12, 4]);
    expect(sequencer).toContain("function patternPlayheadSteps");
    expect(sequencer).toContain(
      "{#each currentPatternPlayheadSteps as playheadStep, index",
    );
  });
});
