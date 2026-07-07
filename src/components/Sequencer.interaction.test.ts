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

    it('uses an empty left click to clear a note selection before creating a note', () => {
        expect(sequencer).toMatch(/if \(selectedNotes\.length > 0 && !e\.shiftKey\) \{\s*clearSelection\(\);\s*return;\s*\}/);
    });

    it('leaves newly added notes unselected for rapid note entry', () => {
        expect(sequencer).toContain('const newNote: ExtendedNote = {pitch: ROW_NOTES[r].name, start: s, len: 1};');
        expect(sequencer).not.toContain('const newNote: ExtendedNote = {pitch: ROW_NOTES[r].name, start: s, len: 1, selected: true};');
    });

    it('auditions an existing note only while its drag changes its pitch', () => {
        expect(sequencer).toContain("const DRAG_PREVIEW_TRACK = 'drag-preview'");
        expect(sequencer).toContain('function previewDraggedNote');
        expect(sequencer).toMatch(/if \(previewPitch === note\.pitch\) \{?return;?\}?/);
        expect(sequencer).toMatch(/if \(deltaS === 0 && deltaR === 0\) \{?return;?\}?/);
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