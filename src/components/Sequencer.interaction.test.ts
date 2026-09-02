import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    describe, expect, it
} from 'vitest';

const sequencer = readFileSync(fileURLToPath(new URL('./Sequencer.svelte', import.meta.url)), 'utf8');

describe('Sequencer note interactions', () => {
    it('opens a focused contextual editor for the note pitch and velocity on double-click', () => {
        expect(sequencer).toContain('function openNoteEditor');
        expect(sequencer).toMatch(/ondblclick=\{stopPropagation\(\(e\) => openNoteEditor\(e as MouseEvent, n\)\)\}/);
        expect(sequencer).toContain('class="note-editor"');
        expect(sequencer).toContain('aria-label="Edit note values"');
        expect(sequencer).toMatch(/bind:value=\{noteDraft\.pitch\}[\s\S]*bind:value=\{noteDraft\.vel\}/);
        expect(sequencer).not.toContain('noteDraft.start');
        expect(sequencer).not.toContain('noteDraft.len');
        expect(sequencer).toMatch(/noteEditorInput\?\.focus\(\)[\s\S]*noteEditorInput\?\.select\(\)/);
    });

    it('closes when an automation editor becomes active', () => {
        expect(sequencer).toContain("const NOTE_EDITOR_KEY = 'note'");
        expect(sequencer).toMatch(/contextualEditor !== NOTE_EDITOR_KEY && noteEditor/);
    });

    it('keeps the pattern editor header from forcing a wider panel', () => {
        expect(sequencer).toContain('<PatternBar/>');
        expect(sequencer).toContain('aria-label="Pattern controls"');
        expect(sequencer).toContain('<div class="editor-toolbar">');
        expect(sequencer).toMatch(/class="pattern-controls"[\s\S]*class="toolbar-hint"[\s\S]*class="instrument-controls"/);
        expect(sequencer).toMatch(/\.toolbar-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(260px, auto\) auto;/s);
        expect(sequencer).toMatch(/\.toolbar-hint\s*\{[\s\S]*text-align:\s*center;/s);
        expect(sequencer).toMatch(/\.toolbar-row\s*\{[^}]*min-height:\s*42px;/s);
        expect(sequencer).toMatch(/\.toolbar-hint\s*\{[^}]*text-align:\s*center;/s);
        expect(sequencer).toMatch(/\.piano-roll-container\s*\{[^}]*min-width:\s*0;/s);
        expect(sequencer).toMatch(/\.instrument-controls\s*\{[^}]*min-width:\s*0;/s);
        expect(sequencer).toMatch(/\.toolbar-hint\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
    });

    it('uses a draggable timeline end handle for pattern length', () => {
        expect(sequencer).toContain('class="length-counter" aria-label="Pattern length"');
        expect(sequencer).toContain('class="pattern-end-handle"');
        expect(sequencer).toContain('function startPatternResize');
        expect(sequencer).toContain('function handlePatternResize');
        expect(sequencer).toMatch(/aria-valuemax="512"[\s\S]*aria-valuemin="1"/);
        expect(sequencer).toContain('setPatternSteps((event.clientX - rect.left) / cellWidth)');
        expect(sequencer).toContain('? {...pattern, steps: nextSteps, tracks}');
        expect(sequencer).not.toContain('pat.steps = nextSteps;');
        expect(sequencer).not.toContain('Shorten pattern by four steps');
        expect(sequencer).not.toContain('Extend pattern by four steps');
        expect(sequencer).toMatch(/\.corner\s*\{[^}]*width:\s*88px;/s);
        expect(sequencer).toMatch(/\.side-bar\s*\{[^}]*width:\s*88px;/s);
    });

    it('draws legato links with their selected transition curve', () => {
        expect(sequencer).toContain('function legatoPath');
        expect(sequencer).toContain('segmentProgress(glide.curve, t)');
        expect(sequencer).toContain('d={legatoPath(line.source, line.target)}');
        expect(sequencer).toMatch(/\.legato-line\s*\{[^}]*fill:\s*none;/s);
        expect(sequencer).not.toContain('<line class="legato-line"');
    });

    it('draws the portamento curve from the source end to the target start', () => {
        expect(sequencer).toContain('legatoTransition(source, target.start, stepDuration');
        expect(sequencer).toContain('sourceX + (targetX - sourceX) * t');
        expect(sequencer).not.toContain('target.start + glide.time / stepDuration');
    });

    it('reserves a stable toolbar slot for portamento controls', () => {
        expect(sequencer).toContain('class="legato-slot"');
        expect(sequencer).toMatch(/\.legato-slot\s*\{[^}]*min-width:\s*260px;[^}]*min-height:\s*28px;/s);
        expect(sequencer).toContain('dragLegatoTargets = new Map');
        expect(sequencer).toContain('updateLegatoTargets(notes, originalPositions, dragLegatoTargets)');
    });

    it('uses an empty left click to clear a note selection and start creating a note', () => {
        expect(sequencer).toMatch(/\} else \{\s*if \(!e\.shiftKey\) \{clearSelection\(\);\}\s*if \(!\$selInstId\) \{return;\}/);
        expect(sequencer).not.toMatch(/if \(selectedNotes\.length > 0 && !e\.shiftKey\) \{\s*clearSelection\(\);\s*return;\s*\}/);
    });

    it('selects a newly added note before using it as the active drag target', () => {
        expect(sequencer).toContain('const newNote: ExtendedNote = {pitch: ROW_NOTES[r].name, start: s, len: 1, selected: true};');
    });

    it('replaces the current instrument track when adding a note so the roll redraws', () => {
        expect(sequencer).toContain('const track = [...(pat.tracks[$selInstId] ?? []), newNote];');
        expect(sequencer).toContain('pat.tracks[$selInstId] = track;');
        expect(sequencer).toContain('dragNote = pat.tracks[$selInstId][track.length - 1] as ExtendedNote;');
        expect(sequencer).not.toContain('notes.push(newNote);');
    });

    it('replaces dragged and resized notes so their updated geometry redraws immediately', () => {
        expect(sequencer).toContain('function replaceEditedNotes');
        expect(sequencer).toContain('function draggedNotes');
        expect(sequencer).toContain('let dragTargets: ExtendedNote[] = [];');
        expect(sequencer).toContain('return dragTargets;');
        expect(sequencer).toContain('const track = pat.tracks[$selInstId] ?? [];');
        expect(sequencer).toContain('pat.tracks[$selInstId] = track.map(note => replacements.get(note) ?? note);');
        expect(sequencer).toContain('dragTargets = dragTargets.map(note => replacements.get(note) ?? note);');
        expect(sequencer).toMatch(/const targetNotes = draggedNotes\(\);[\s\S]*replaceEditedNotes\(targetNotes\)[\s\S]*dragNote = replacements\.get\(dragNote\) \?\? dragNote;/);
    });

    it('keeps a newly placed note as the active drag target until mouse-up', () => {
        expect(sequencer).toMatch(/const newNote: ExtendedNote = \{pitch: ROW_NOTES\[r\]\.name, start: s, len: 1, selected: true\};[\s\S]*dragNote = pat\.tracks\[\$selInstId\]\[track\.length - 1\] as ExtendedNote;[\s\S]*beginNoteDrag\(dragNote, r, s, s_raw\);/);
        expect(sequencer).toMatch(/dragNote = null;\s*dragTargets = \[\];/);
    });

    it('initializes each movable note drag from the current track and auditions it immediately', () => {
        expect(sequencer).toContain('function beginNoteDrag');
        expect(sequencer).toMatch(/const targetNotes = note\.selected \? \(pat\.tracks\[\$selInstId\] \?\? \[\]\)\.filter\(current => current\.selected\) as ExtendedNote\[\] : \[note\];/);
        expect(sequencer).toMatch(/dragTargets = targetNotes;[\s\S]*void previewDraggedNote\(note\);/);
        expect(sequencer).toMatch(/beginNoteDrag\(found, r, s, s_raw\);/);
        expect(sequencer).toMatch(/beginNoteDrag\(dragNote, r, s, s_raw\);/);
    });

    it('replaces the note track when deleting so the roll redraws immediately', () => {
        expect(sequencer).toMatch(/function deleteNoteAt[\s\S]*const track = pat\.tracks\[\$selInstId\] \?\? \[\];[\s\S]*pat\.tracks\[\$selInstId\] = track\.filter\(note => note !== found\);/);
        expect(sequencer).not.toContain('notes.splice(notes.indexOf(found), 1);');
    });

    it('commits selection and legato edits as new track arrays so the roll redraws', () => {
        expect(sequencer).toMatch(/function commitCurrentTrack\(\)[\s\S]*pat\.tracks\[\$selInstId\] = \[\.\.\.\(pat\.tracks\[\$selInstId\] \?\? \[\]\)\];/);
        expect(sequencer).toMatch(/function clearSelection\(\)[\s\S]*commitCurrentTrack\(\);/);
        expect(sequencer).toMatch(/function addLegato\(\)[\s\S]*if \(createLegatoBetweenSelected\(\)\) \{commitCurrentTrack\(\);\}/);
    });

    it('replaces selection-changed notes so their selected border follows the logical selection', () => {
        expect(sequencer).toContain('function updateNoteSelection');
        expect(sequencer).toContain('function selectOnlyNote');
        expect(sequencer).toMatch(/function clearSelection\(\)[\s\S]*updateNoteSelection\(\(note\) => note\.selected \? false : note\.selected\);/);
        expect(sequencer).toMatch(/function selectOnlyNote\(note: ExtendedNote\)[\s\S]*updateNoteSelection\(\(current\) => current === note\);/);
    });

    it('measures drag coordinates against the scrolled grid background', () => {
        expect(sequencer).toContain('function gridPositionAt');
        expect(sequencer).toContain("rollEl.querySelector('.grid-container')");
        expect(sequencer).toMatch(/handleMouseDown\(mouseEvent, gridPosition\.r, gridPosition\.s\);/);
    });

    it('retunes the held preview voice whenever a dragged note changes pitch', () => {
        expect(sequencer).toContain("const DRAG_PREVIEW_TRACK = 'drag-preview'");
        expect(sequencer).toContain('function previewDraggedNote');
        expect(sequencer).toContain('const pitch = note.pitch;');
        expect(sequencer).toContain('const velocity = note.vel ?? 1;');
        expect(sequencer).toMatch(/if \(previewPitch === pitch\) \{?return;?\}?/);
        expect(sequencer).toMatch(/if \(deltaS === 0 && deltaR === 0\) \{?return;?\}?/);
        expect(sequencer).toContain('let activePreviewPitch: string | null = null;');
        expect(sequencer).toContain('const previousPitch = activePreviewPitch;');
        expect(sequencer).toContain('lastPlayedPitch.set(pitch);');
        expect(sequencer).toContain('glideAt(DRAG_PREVIEW_TRACK, previousPitch, pitch, 0, 0.015)');
        expect(sequencer).toContain('if (previousPitch) {noteOff(DRAG_PREVIEW_TRACK, previousPitch);}');
        expect(sequencer).toContain('noteOnAt(DRAG_PREVIEW_TRACK, pitch, 0, selectedInstrument().params, velocity);');
        expect(sequencer).toContain('activePreviewPitch = pitch;');
        expect(sequencer).toContain('previewDraggedNote(dragNote);');
        expect(sequencer).toContain('function stopDragPreview');
        expect(sequencer).toContain('stopDragPreview();');
    });

    it('follows the active pattern playhead and hides song playback outside the open pattern', () => {
        expect(sequencer).toContain('playMode');
        expect(sequencer).toContain('function patternPlayheadStep');
        expect(sequencer).toContain("if ($playMode === 'pattern')");
        expect(sequencer).toContain("if ($playMode !== 'song') {return null;}");
        expect(sequencer).toContain('scrollPlayheadIntoView(rollEl, currentPatternPlayheadStep, cellWidth, 88)');
        expect(sequencer).toContain('{#if currentPatternPlayheadStep !== null}');
    });
});