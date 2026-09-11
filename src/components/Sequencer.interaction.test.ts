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
  it("opens a focused contextual editor for note velocity on double-click", () => {
    expect(sequencer).toContain("function openNoteEditor");
    expect(sequencer).toMatch(
      /ondblclick=\{stopPropagation\(\(?e\)? => openNoteEditor\(e as MouseEvent, n\)\)\}/,
    );
    expect(sequencer).toContain('class="note-editor"');
    expect(sequencer).toContain('aria-label="Edit note values"');
    expect(sequencer).toContain('type="range"');
    expect(sequencer).toContain('aria-label="Velocity percentage"');
    expect(sequencer).toMatch(
      /max="100"[\s\S]*min="1"[\s\S]*bind:value=\{noteDraft\.vel\}/,
    );
    expect(sequencer).not.toContain("bind:value={noteDraft.pitch}");
    expect(sequencer).toContain(
      "noteEditorError = 'Enter a velocity from 1 to 100%';",
    );
    expect(sequencer).toContain(
      "noteEditor.vel = clampVel(velocityPercent / 100);",
    );
    expect(sequencer).not.toContain("noteDraft.start");
    expect(sequencer).not.toContain("noteDraft.len");
    expect(sequencer).toMatch(
      /noteEditorInput\?\.focus\(\)[\s\S]*noteEditorInput\?\.select\(\)/,
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

  it("closes when an automation editor becomes active", () => {
    expect(sequencer).toContain("const NOTE_EDITOR_KEY = 'note'");
    expect(sequencer).toMatch(
      /contextualEditor !== NOTE_EDITOR_KEY && noteEditor/,
    );
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
      elements(markup, "div").some((element) =>
        hasAttribute(element, "class", "legato-slot"),
      ),
    ).toBe(true);
    expect(
      elements(markup, "button").some((element) =>
        hasAttribute(element, "class", "instrument-edit"),
      ),
    ).toBe(true);
    expect(styles.get(".toolbar-row")?.get("grid-template-columns")).toBe(
      "minmax(0, 1fr) minmax(260px, auto) auto",
    );
    expect(styles.get(".toolbar-hint")?.get("text-align")).toBe("center");
    expect(styles.get(".piano-roll-container")?.get("min-width")).toBe("0");
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

  it("reserves a stable toolbar slot for portamento controls", () => {
    expect(sequencer).toContain('class="legato-slot"');
    expect(sequencer).toMatch(
      /\.legato-slot\s*\{[^}]*min-width:\s*260px;[^}]*min-height:\s*28px;/s,
    );
    expect(sequencer).toContain("dragLegatoTargets = new Map");
    expect(sequencer).toMatch(
      /updateLegatoTargets\(notes,\s*originalPositions,\s*dragLegatoTargets\)/,
    );
  });

  it("uses an empty left click to clear a note selection and start creating a note", () => {
    expect(
      functionHasCall(sequencer, "handleMouseDown", "clearSelection"),
    ).toBe(true);
    expect(sequencer).not.toMatch(
      /if \(selectedNotes\.length > 0 && !e\.shiftKey\) \{\s*clearSelection\(\);\s*return;\s*\}/,
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

  it("replaces the note track when deleting so the roll redraws immediately", () => {
    expect(sequencer).toMatch(
      /function deleteNoteAt[\s\S]*const track = pat\.tracks\[\$selInstId\] \?\? \[\];[\s\S]*pat\.tracks\[\$selInstId\] = track\.filter\(note => note !== found\);/,
    );
    expect(sequencer).not.toContain("notes.splice(notes.indexOf(found), 1);");
  });

  it("commits selection and legato edits as new track arrays so the roll redraws", () => {
    expect(sequencer).toMatch(
      /function commitCurrentTrack\(\)[\s\S]*pat\.tracks\[\$selInstId\] = \[\.\.\.\(pat\.tracks\[\$selInstId\] \?\? \[\]\)\];/,
    );
    expect(sequencer).toMatch(
      /function clearSelection\(\)[\s\S]*commitCurrentTrack\(\);/,
    );
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
      componentFunction<() => number | null>(sequencer, "patternPlayheadStep", {
        $playing: playing,
        $playMode: mode,
        $curStep: curStep,
        $project: { arrangement: [] },
        pat: { id: "pattern" },
        steps: 16,
      })();

    expect(sequencer).toContain("playMode");
    expect(sequencer).toContain("function patternPlayheadStep");
    expect(sequencer).toContain("if ($playMode === 'pattern')");
    expect(playheadStep(true, "pattern", 19)).toBe(3);
    expect(playheadStep(true, "preview", 19)).toBeNull();
    expect(sequencer).toMatch(
      /scrollPlayheadIntoView\(rollEl,\s*currentPatternPlayheadStep,\s*cellWidth,\s*88\)/,
    );
    expect(sequencer).toContain("{#if currentPatternPlayheadStep !== null}");
  });
});
