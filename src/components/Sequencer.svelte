<script lang="ts">
    import {onDestroy, onMount, tick} from 'svelte';

    import type {Note, NoteParamOverrides, Pattern} from '../lib/types';

    import {CURVE_SHAPES, INSTRUMENT_AUTO_PARAMS, segmentProgress} from '../lib/automation';
    import {ensureAudio, glideAt, noteOff, noteOnAt} from '../lib/engine';
    import {legatoTransition} from '../lib/legato';
    import {
        clampVel,
        createLegatoBetweenSelected,
        deleteNotes,
        editStep,
        removeInvalidLegatoLinks,
        shouldPlaceNote,
        updateLegatoTargets,
    } from '../lib/noteops';
    import {ROW_NOTES, rowOfNote, STEPS} from '../lib/notes';
    import {
        curStep,
        lastPlayedPitch,
        playing,
        playMode,
        project,
        selectedInstrument,
        selInstId,
        selPatId,
        touch,
    } from '../lib/project';
    import {rendering} from '../lib/render';
    import {playPattern, stopTransport} from '../lib/transport';
    import {
        createViewportState,
        handleViewportMouseDown,
        handleViewportMouseMove,
        handleViewportMouseUp,
        handleViewportWheel,
    } from '../lib/viewport';
    import {preventDefault, stopPropagation} from './event-modifiers';

    interface Props {
        contextualEditor?: string | null;
        onEditInstrument?: () => void;
        onToggleFocus?: () => void;
        patternFocused?: boolean;
    }

    let {
        contextualEditor = $bindable(null),
        onEditInstrument = () => {},
        onToggleFocus = () => {},
        patternFocused = false,
    }: Props = $props();

    const NOTE_EDITOR_KEY = 'note';
    const DRAG_PREVIEW_TRACK = 'drag-preview';

    const patternPlaying = $derived($playing && $playMode === 'pattern');

    function togglePatternPlayback() {
        if (!$project || $rendering) {
            return;
        }
        if ($playing && $playMode === 'pattern') {
            stopTransport();
        } else {
            void playPattern();
        }
    }

    function patternPlayheadSteps(): number[] {
        if (!$playing || !$project || $curStep < 0) {
            return [];
        }
        if ($playMode === 'pattern') {
            return [$curStep % steps];
        }
        if ($playMode !== 'song') {
            return [];
        }
        const anyLaneSolo = $project.tracks.some(track => track.solo);
        return $project.arrangement
            .filter(clip => {
                const lane = $project!.tracks[clip.track];
                return (
                    clip.patternId === pat.id &&
                    $curStep >= clip.start &&
                    $curStep < clip.start + clip.len &&
                    (!lane || (!lane.mute && (!anyLaneSolo || lane.solo)))
                );
            })
            .map(clip => ($curStep - clip.start) % steps);
    }

    function scrollPlayheadIntoView(
        container: HTMLElement | undefined,
        step: number,
        width: number,
        sidebarWidth: number,
    ) {
        if (!container) {
            return;
        }
        const position = sidebarWidth + step * width - container.scrollLeft;
        const padding = Math.min(48, container.clientWidth / 4);
        // The piano-key strip is a sticky overlay `sidebarWidth` wide, so the
        // playhead only reads as visible once it clears it — treating anything
        // past `padding` as on screen let a manual scroll strand the line under
        // the keys, where it blends in and auto-follow never pulls it back.
        const leftEdge = Math.max(padding, sidebarWidth + 8);
        if (position >= leftEdge && position <= container.clientWidth - padding) {
            return;
        }
        const nextLeft = sidebarWidth + step * width - container.clientWidth * 0.35;
        container.scrollLeft = Math.max(
            0,
            Math.min(nextLeft, container.scrollWidth - container.clientWidth),
        );
    }

    let resizingPattern = $state(false);
    let patternTimelineEl: HTMLElement | undefined = $state();

    function setPatternSteps(nextSteps: number) {
        nextSteps = Math.max(1, Math.min(512, Math.round(nextSteps)));
        if (nextSteps === steps || !$project) {
            return;
        }
        const tracks = Object.fromEntries(
            Object.entries(pat.tracks).map(([id, track]) => [
                id,
                track.filter(note => note.start < nextSteps),
            ]),
        );
        $project.patterns = $project.patterns.map(pattern =>
            pattern.id === pat.id ? { ...pattern, steps: nextSteps, tracks } : pattern,
        );
        touch();
    }

    function startPatternResize(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        resizingPattern = true;
    }

    function handlePatternResize(event: MouseEvent) {
        if (!resizingPattern || !patternTimelineEl) {
            return;
        }
        const rect = patternTimelineEl.getBoundingClientRect();
        setPatternSteps((event.clientX - rect.left) / cellWidth);
    }

    function handlePatternResizeKeydown(event: KeyboardEvent) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            setPatternSteps(steps - 1);
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            setPatternSteps(steps + 1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            setPatternSteps(1);
        } else if (event.key === 'End') {
            event.preventDefault();
            setPatternSteps(512);
        }
    }

    interface ExtendedNote extends Note {
        _initStart?: number;
        _initLen?: number;
        _initRow?: number;
        _initVel?: number;
    }

    let dragNote: ExtendedNote | null = $state(null);
    let dragStartRawS = 0;
    let dragStartPos = { s: 0, r: 0 };
    let dragOffset = { s: 0, r: 0 };
    let dragStartY = 0;
    let dragTargets: ExtendedNote[] = [];
    let resizeMode = $state(false);
    let velMode = $state(false);
    let dragLegatoTargets = new Map<Note, Pick<NonNullable<Note['legatoTo']>, 'pitch' | 'start'>>();
    let previewPitch: string | null = null;
    let activePreviewPitch: string | null = null;
    let rollEl: HTMLElement | undefined = $state();
    let selectionRevision = $state(0);
    let sequencerZoom = $state({
        width: $project?.zoom.seq.width ?? 24,
        height: $project?.zoom.seq.height ?? 14,
    });
    const unsubscribeProjectZoom = project.subscribe(currentProject => {
        if (currentProject) {
            sequencerZoom = {...currentProject.zoom.seq};
        }
    });
    onDestroy(unsubscribeProjectZoom);

    function setZoom(w: number, h: number) {
        if (!$project) {
            return;
        }
        sequencerZoom.width = w;
        sequencerZoom.height = h;
        $project.zoom.seq.width = w;
        $project.zoom.seq.height = h;
    }

    const viewport = createViewportState();

    let isSelecting = $state(false);
    let isRightDragging = false;
    let selectionStart = $state({ s: 0, r: 0 });
    let selectionEnd = $state({ s: 0, r: 0 });
    // Keep the pattern track's original note reference so Apply can replace it
    // after the draft values have been edited.
    let noteEditor: ExtendedNote | null = $state.raw(null);
    let noteDraft = $state({vel: 100, overrides: {} as NoteParamOverrides});
    let overrideToAdd = $state('');
    let noteEditorPosition = $state({ left: 4, top: 4 });
    let noteEditorError = $state('');
    let noteEditorInput: HTMLInputElement | undefined = $state();
    let legatoMenuOpen = $state(false);

    onMount(async () => {
        await tick();
        if (rollEl) {
            const c5Row = rowOfNote['C5'];
            if (c5Row !== undefined) {
                rollEl.scrollTop = c5Row * cellHeight - rollEl.clientHeight / 2;
            }
        }
    });

    onDestroy(() => {
        stopDragPreview();
    });

    async function previewDraggedNote(note: Note) {
        const pitch = note.pitch;
        const velocity = note.vel ?? 1;
        if (previewPitch === pitch) {
            return;
        }
        previewPitch = pitch;
        lastPlayedPitch.set(pitch);
        await ensureAudio();
        if (previewPitch !== pitch) {
            return;
        }
        const previousPitch = activePreviewPitch;
        if (!previousPitch || !glideAt(DRAG_PREVIEW_TRACK, previousPitch, pitch, 0, 0.015)) {
            if (previousPitch) {
                noteOff(DRAG_PREVIEW_TRACK, previousPitch);
            }
            noteOnAt(DRAG_PREVIEW_TRACK, pitch, 0, selectedInstrument().params, velocity);
        }
        activePreviewPitch = pitch;
    }

    function stopDragPreview() {
        if (activePreviewPitch) {
            noteOff(DRAG_PREVIEW_TRACK, activePreviewPitch);
        }
        activePreviewPitch = null;
        previewPitch = null;
    }

    function clearSelection() {
        updateNoteSelection(note => (note.selected ? false : note.selected));
    }

    function updateNoteSelection(
        selectionForNote: (note: ExtendedNote) => boolean | undefined,
    ): Map<ExtendedNote, ExtendedNote> {
        const replacements = new Map<ExtendedNote, ExtendedNote>();
        if (!$selInstId) {
            return replacements;
        }
        const track = pat.tracks[$selInstId] ?? [];
        track.forEach(note => {
            const selected = selectionForNote(note as ExtendedNote);
            if (note.selected === selected) {
                return;
            }
            note.selected = selected;
            replacements.set(note as ExtendedNote, note as ExtendedNote);
        });
        if (replacements.size) {
            selectionRevision++;
        }
        return replacements;
    }

    function selectOnlyNote(note: ExtendedNote): ExtendedNote {
        const replacements = updateNoteSelection(current => current === note);
        return replacements.get(note) ?? note;
    }

    function toggleNoteSelection(note: ExtendedNote): ExtendedNote {
        const replacements = updateNoteSelection(current =>
            current === note ? !current.selected : current.selected,
        );
        return replacements.get(note) ?? note;
    }

    function commitCurrentTrack() {
        if (!$selInstId) {
            return;
        }
        pat.tracks[$selInstId] = [...(pat.tracks[$selInstId] ?? [])];
        touch();
    }

    function replaceEditedNotes(editedNotes: ExtendedNote[]): Map<Note, ExtendedNote> {
        const replacements = new Map<Note, ExtendedNote>(
            editedNotes.map(note => [note, { ...note }] as const),
        );
        if (!$selInstId) {
            return replacements;
        }
        const track = pat.tracks[$selInstId] ?? [];
        pat.tracks[$selInstId] = track.map(note => replacements.get(note) ?? note);
        dragTargets = dragTargets.map(note => replacements.get(note) ?? note);
        dragLegatoTargets = new Map<Note, Pick<NonNullable<Note['legatoTo']>, 'pitch' | 'start'>>(
            [...dragLegatoTargets].map(
                ([note, target]) => [replacements.get(note) ?? note, target] as const,
            ),
        );
        return replacements;
    }

    function draggedNotes(): ExtendedNote[] {
        return dragTargets;
    }

    function beginNoteDrag(
        note: ExtendedNote,
        r: number,
        s: number,
        s_raw: number,
    ): ExtendedNote[] {
        dragNote = note;
        dragStartRawS = s_raw;
        dragStartPos = { s, r };
        if (!$selInstId) {
            return [note];
        }
        const targetNotes = note.selected
            ? ((pat.tracks[$selInstId] ?? []).filter(current => current.selected) as ExtendedNote[])
            : [note];
        dragTargets = targetNotes;
        dragOffset = { s: s - note.start, r: r - rowOfNote[note.pitch] };
        dragLegatoTargets = new Map(
            notes.flatMap(current =>
                current.legatoTo
                    ? [
                          [
                              current,
                              {
                                  pitch: current.legatoTo.pitch,
                                  start: current.legatoTo.start,
                              },
                          ] as const,
                      ]
                    : [],
            ),
        );
        targetNotes.forEach(current => {
            current._initStart = current.start;
            current._initRow = rowOfNote[current.pitch];
        });
        void previewDraggedNote(note);
        return targetNotes;
    }

    function addLegato() {
        if (createLegatoBetweenSelected()) {
            commitCurrentTrack();
        }
    }

    function updateLegatoCurve(curve: string) {
        if (
            !selectedSlidePair?.connected ||
            !selectedSlidePair.source.legatoTo ||
            !CURVE_SHAPES.some(shape => shape.id === curve)
        ) {
            return;
        }
        selectedSlidePair.source.legatoTo.curve = curve as NonNullable<Note['legatoTo']>['curve'];
        commitCurrentTrack();
    }

    function removeLegato() {
        if (!selectedSlidePair?.connected || !selectedSlidePair.source.legatoTo) {
            return;
        }
        delete selectedSlidePair.source.legatoTo;
        commitCurrentTrack();
        legatoMenuOpen = false;
    }

    function toggleLegatoMenu() {
        legatoMenuOpen = !legatoMenuOpen;
    }

    function legatoPath(source: Note, target: Note): string {
        const sourceX = (source.start + source.len) * cellWidth;
        const sourceY = ((rowOfNote[source.pitch] ?? 0) + 0.5) * cellHeight;
        const targetX = target.start * cellWidth;
        const targetY = ((rowOfNote[target.pitch] ?? 0) + 0.5) * cellHeight;
        const stepDuration = 60 / ($project?.bpm || 112) / 4;
        const glide = legatoTransition(
            source,
            target.start,
            stepDuration,
            $project?.instruments.find(value => value.id === $selInstId)?.params.legatoCurve,
        );
        const segments = [`M ${sourceX} ${sourceY}`];
        for (let sample = 1; sample <= 12; sample++) {
            const t = sample / 12;
            const y = sourceY + (targetY - sourceY) * segmentProgress(glide.curve, t);
            segments.push(`L ${sourceX + (targetX - sourceX) * t} ${y}`);
        }
        return segments.join(' ');
    }

    function snapStep(): number {
        return cellWidth > 160
            ? 0.0625
            : cellWidth > 80
              ? 0.125
              : cellWidth > 40
                ? 0.25
                : cellWidth > 20
                  ? 0.5
                  : 1;
    }

    function openNoteEditor(e: Event, note: ExtendedNote) {
        e.preventDefault();
        const selectedNote = note.selected ? note : selectOnlyNote(note);
        const row = rowOfNote[selectedNote.pitch] ?? 0;
        noteEditor = selectedNote;
        noteDraft = {
            vel: Math.round((selectedNote.vel ?? 1) * 100),
            overrides: {...selectedNote.overrides},
        };
        overrideToAdd = '';
        noteEditorPosition = {
            left: Math.max(4, Math.min(steps * cellWidth - 228, selectedNote.start * cellWidth)),
            top: Math.max(
                4,
                Math.min(ROW_NOTES.length * cellHeight - 84, (row + 1) * cellHeight + 4),
            ),
        };
        noteEditorError = '';
        lastPlayedPitch.set(selectedNote.pitch);
        contextualEditor = NOTE_EDITOR_KEY;
        tick().then(() => {
            noteEditorInput?.focus();
            noteEditorInput?.select();
        });
    }

    function openNoteEditorFromKeyboard(event: KeyboardEvent, note: ExtendedNote) {
        if (event.key === 'Enter' || event.key === ' ') {
            openNoteEditor(event, note);
        }
    }

    function closeNoteEditor() {
        noteEditor = null;
        noteEditorError = '';
        if (contextualEditor === NOTE_EDITOR_KEY) {
            contextualEditor = null;
        }
    }

    function saveNoteEditor() {
        if (!noteEditor) {
            return;
        }
        const velocityPercent = Number(noteDraft.vel);
        if (!Number.isFinite(velocityPercent) || velocityPercent < 1 || velocityPercent > 100) {
            noteEditorError = 'Enter a velocity from 1 to 100%';
            return;
        }
        noteEditor.vel = clampVel(velocityPercent / 100);
        const overrides = Object.fromEntries(
            Object.entries(noteDraft.overrides).filter(
                ([param, value]) =>
                    INSTRUMENT_AUTO_PARAMS.some(def => def.param === param) &&
                    Number.isFinite(value),
            ),
        ) as NoteParamOverrides;
        noteEditor.overrides = Object.keys(overrides).length ? overrides : undefined;
        const replacements = replaceEditedNotes([noteEditor]);
        noteEditor = replacements.get(noteEditor) ?? noteEditor;
        touch();
        closeNoteEditor();
    }

    function addNoteOverride() {
        const def = INSTRUMENT_AUTO_PARAMS.find(value => value.param === overrideToAdd);
        if (!def || noteDraft.overrides[def.param] !== undefined) {
            return;
        }
        noteDraft.overrides = {
            ...noteDraft.overrides,
            [def.param]: (selectedInstrument().params as unknown as Record<string, number>)[def.param],
        };
        overrideToAdd = '';
    }

    function removeNoteOverride(param: keyof NoteParamOverrides) {
        const {[param]: _, ...remaining} = noteDraft.overrides;
        noteDraft.overrides = remaining;
    }

    function onNoteEditorKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeNoteEditor();
        }
    }

    function deleteNoteAt(r: number, s: number) {
        if (!$selInstId) {
            return;
        }
        const track = pat.tracks[$selInstId] ?? [];
        const found = track.find(
            n => rowOfNote[n.pitch] === r && s >= n.start && s < n.start + n.len,
        );
        if (found) {
            deleteNotes([found]);
        }
    }

    function handleMouseDown(e: MouseEvent, r: number, s_raw: number) {
        if (e.button === 1) {
            return;
        }

        const snap = snapStep();
        const s = Math.round(s_raw / snap) * snap;

        if (e.button === 2) {
            // Right click delete
            isRightDragging = true;
            deleteNoteAt(r, s_raw);
            return;
        }

        if (e.button !== 0) {
            return;
        }

        let found = notes.find(
            n => rowOfNote[n.pitch] === r && s_raw >= n.start && s_raw < n.start + n.len,
        ) as ExtendedNote;
        lastPlayedPitch.set(found?.pitch || ROW_NOTES[r].name);

        editStep.set(Math.max(0, s)); // paste anchor (Ctrl+V)

        if (e.altKey && found) {
            // Alt+drag = velocity of the selection
            if (!found.selected) {
                found = selectOnlyNote(found);
            }
            dragNote = found;
            dragTargets = notes.filter(n => n.selected) as ExtendedNote[];
            velMode = true;
            resizeMode = false;
            dragStartY = e.clientY;
            (notes.filter(n => n.selected) as ExtendedNote[]).forEach(
                n => (n._initVel = n.vel ?? 1),
            );
            return;
        }

        if (e.ctrlKey && !found) {
            isSelecting = true;
            selectionStart = { s: s_raw, r };
            selectionEnd = { s: s_raw, r };
            if (!e.shiftKey) {
                clearSelection();
            }
            return;
        }

        if (found) {
            if (e.shiftKey || e.ctrlKey) {
                found = toggleNoteSelection(found);
            } else {
                if (!found.selected) {
                    found = selectOnlyNote(found);
                }
            }
            const targetNotes = beginNoteDrag(found, r, s, s_raw);
            if ((e.target as HTMLElement).classList.contains('resize-handle')) {
                resizeMode = true;
                targetNotes.forEach(n => (n._initLen = n.len));
            } else {
                resizeMode = false;
            }
        } else {
            if (!shouldPlaceNote(selectedNotes.length > 0, e.shiftKey)) {
                clearSelection();
                return;
            }
            if (!e.shiftKey) {
                clearSelection();
            }
            if (!$selInstId) {
                return;
            }
            const newNote: ExtendedNote = {
                pitch: ROW_NOTES[r].name,
                start: s,
                len: 1,
                selected: true,
            };
            const track = [...(pat.tracks[$selInstId] ?? []), newNote];
            pat.tracks[$selInstId] = track;
            dragNote = pat.tracks[$selInstId][track.length - 1] as ExtendedNote;
            beginNoteDrag(dragNote, r, s, s_raw);
            commitCurrentTrack();
        }
    }

    function handleMouseMove(e: MouseEvent, r: number, s_raw: number) {
        if (isRightDragging) {
            deleteNoteAt(r, s_raw);
            return;
        }

        if (isSelecting) {
            selectionEnd = { s: s_raw, r };
            const s_min = Math.min(selectionStart.s, selectionEnd.s);
            const s_max = Math.max(selectionStart.s, selectionEnd.s);
            const r_min = Math.min(selectionStart.r, selectionEnd.r);
            const r_max = Math.max(selectionStart.r, selectionEnd.r);

            updateNoteSelection(note => {
                const nr = rowOfNote[note.pitch];
                const inRect =
                    note.start < s_max &&
                    note.start + note.len > s_min &&
                    nr >= r_min &&
                    nr <= r_max;
                if (e.shiftKey) {
                    return inRect || note.selected;
                }
                return inRect;
            });
            return;
        }

        if (velMode && dragNote) {
            const delta = (dragStartY - e.clientY) / 120; // ~120px = full range
            const targetNotes = draggedNotes();
            targetNotes.forEach(n => (n.vel = clampVel((n._initVel ?? 1) + delta)));
            const replacements = replaceEditedNotes(targetNotes);
            dragNote = replacements.get(dragNote) ?? dragNote;
            touch();
            return;
        }

        if (!dragNote || isNaN(r) || isNaN(s_raw)) {
            return;
        }

        const snap = snapStep();

        if (resizeMode) {
            const deltaLen = s_raw - dragStartRawS;
            const targetNotes = draggedNotes();
            targetNotes.forEach(n => {
                const initLen = n._initLen ?? n.len;
                const newLen = Math.max(snap, initLen + deltaLen);
                n.len = Math.round(newLen / snap) * snap;
            });
            removeInvalidLegatoLinks(notes);
            const replacements = replaceEditedNotes(targetNotes);
            dragNote = replacements.get(dragNote) ?? dragNote;
            touch();
        } else {
            const deltaS = s_raw - dragStartRawS;
            const deltaR = r - dragStartPos.r;
            const targetNotes = draggedNotes();
            const originalPositions = new Map(
                targetNotes.map(n => [
                    n,
                    {
                        start: n._initStart ?? n.start,
                        pitch: ROW_NOTES[n._initRow ?? rowOfNote[n.pitch]].name,
                    },
                ]),
            );
            targetNotes.forEach(n => {
                const initStart = n._initStart ?? n.start;
                const initRow = n._initRow ?? rowOfNote[n.pitch];
                const newStart = Math.max(0, initStart + deltaS);
                n.start = Math.round(newStart / snap) * snap;
                const targetRow = Math.max(0, Math.min(ROW_NOTES.length - 1, initRow + deltaR));
                n.pitch = ROW_NOTES[targetRow].name;
            });
            if (deltaS === 0 && deltaR === 0) {
                return;
            }
            updateLegatoTargets(notes, originalPositions, dragLegatoTargets);
            const replacements = replaceEditedNotes(targetNotes);
            dragNote = replacements.get(dragNote) ?? dragNote;
            void previewDraggedNote(dragNote);
            touch();
        }
    }

    function handleMouseUp() {
        resizingPattern = false;
        stopDragPreview();
        if (dragNote) {
            lastPlayedPitch.set(dragNote.pitch);
            draggedNotes().forEach(n => {
                delete n._initLen;
                delete n._initStart;
                delete n._initRow;
                delete n._initVel;
            });
        }
        dragNote = null;
        dragTargets = [];
        dragLegatoTargets = new Map();
        handleViewportMouseUp(viewport);
        isSelecting = false;
        isRightDragging = false;
        velMode = false;
    }

    function handleWheel(e: WheelEvent) {
        handleViewportWheel(e, viewportOptions);
    }

    function handleRollMouseDown(e: MouseEvent) {
        handleViewportMouseDown(e, viewport);
        if (!(e.target as Element).closest('.grid-row')) {
            return;
        }
        const gridPosition = gridPositionAt(e);
        handleMouseDown(e, gridPosition.r, gridPosition.s);
    }

    function gridPositionAt(e: MouseEvent): { r: number; s: number } {
        if (!rollEl) {
            return { r: NaN, s: NaN };
        }
        const grid = rollEl.querySelector('.grid-container') as HTMLElement;
        if (!grid) {
            return { r: NaN, s: NaN };
        }
        const rect = grid.getBoundingClientRect();
        return {
            r: Math.floor((e.clientY - rect.top) / cellHeight),
            s: (e.clientX - rect.left) / cellWidth,
        };
    }

    function handleMouseMoveGlobal(e: MouseEvent) {
        if (resizingPattern) {
            handlePatternResize(e);
            return;
        }
        if (handleViewportMouseMove(e, viewport, viewportOptions)) {
            return;
        }

        const gridPosition = gridPositionAt(e);
        handleMouseMove(e, gridPosition.r, gridPosition.s);
    }

    const pat = $derived(
        ($project?.patterns.find(p => p.id === $selPatId) || $project?.patterns[0]) as Pattern,
    );
    const steps = $derived(pat.steps || STEPS);
    const notes = $derived($project && $selInstId ? (pat.tracks[$selInstId] ?? []) : []);
    const displayedNotes = $derived.by(() => {
        selectionRevision;
        return [...notes] as ExtendedNote[];
    });
    const currentPatternPlayheadSteps = $derived(patternPlayheadSteps());
    const currentPatternPlayheadStep = $derived(currentPatternPlayheadSteps[0] ?? null);
    const cellWidth = $derived(sequencerZoom.width);
    $effect.pre(() => {
        if (currentPatternPlayheadStep !== null) {
            scrollPlayheadIntoView(rollEl, currentPatternPlayheadStep, cellWidth, 88);
        }
    });
    const ghosts = $derived(
        $project
            ? Object.entries(pat.tracks)
                  .filter(([id]) => id !== $selInstId)
                  .flatMap(([_, n]) => n)
            : [],
    );
    const cellHeight = $derived(sequencerZoom.height);
    const viewportOptions = $derived({
        getContainer: () => rollEl!,
        getZoom: () => ({ width: cellWidth, height: cellHeight }),
        setZoom,
        sidebarWidth: 44,
    });
    const selectionRect = $derived(
        isSelecting
            ? {
                  left: Math.min(selectionStart.s, selectionEnd.s) * cellWidth,
                  top: Math.min(selectionStart.r, selectionEnd.r) * cellHeight,
                  width: Math.abs(selectionStart.s - selectionEnd.s) * cellWidth,
                  height: (Math.abs(selectionStart.r - selectionEnd.r) + 1) * cellHeight,
              }
            : null,
    );
    const selectedNotes = $derived.by(() => {
        selectionRevision;
        return notes.filter(n => n.selected) as ExtendedNote[];
    });
    const legatoLines = $derived(
        notes.flatMap(source => {
            if (!source.legatoTo) {
                return [];
            }
            const target = notes.find(
                note =>
                    note.start === source.legatoTo?.start && note.pitch === source.legatoTo.pitch,
            );
            if (!target) {
                return [];
            }
            return [{ source, target }];
        }),
    );
    const selectedSlidePair = $derived.by(() => {
        if (selectedNotes.length !== 2) {
            return null;
        }
        const [source, target] = [...selectedNotes].sort((a, b) => a.start - b.start);
        if (!source || !target || target.start < source.start + source.len) {
            return null;
        }
        return {
            source,
            target,
            connected:
                source.legatoTo?.pitch === target.pitch && source.legatoTo.start === target.start,
        };
    });
    $effect(() => {
        if (!selectedSlidePair?.connected) {
            legatoMenuOpen = false;
        }
    });
    $effect.pre(() => {
        if (contextualEditor !== NOTE_EDITOR_KEY && noteEditor) {
            noteEditor = null;
            noteEditorError = '';
        }
    });
</script>

<svelte:window onmousemove={handleMouseMoveGlobal} onmouseup={handleMouseUp} />

<div
    class="piano-roll-container"
    class:pattern-resizing={resizingPattern}
    class:resizing={resizeMode && !!dragNote}
    class:vel-dragging={velMode && !!dragNote}
>
    <!-- PatternBar is intentionally hosted beside the arranger; keeping its own component boundary prevents the piano-roll header from widening. -->
    <div class="editor-toolbar">
        <div class="toolbar-row">
            <div class="pattern-controls">
                <button
                    class="pattern-preview"
                    aria-label="Play pattern"
                    aria-pressed={patternPlaying}
                    disabled={!$project || $rendering}
                    onclick={togglePatternPlayback}
                    title={patternPlaying
                        ? 'Stop pattern playback (Shift+Space)'
                        : 'Play selected pattern on repeat (Shift+Space)'}
                    type="button"
                >
                    {#if patternPlaying}
                        <span><i class="fa fa-stop" aria-hidden="true"></i></span>
                    {:else}
                        <span><i class="fa fa-play" aria-hidden="true"></i></span>
                    {/if}
                </button>
                <span class="toolbar-hint">Alt+drag = velocity</span>
            </div>
            <div class="toolbar-actions">
                <button
                    class="pattern-focus"
                    aria-label={patternFocused ? 'Exit pattern focus mode' : 'Focus pattern editor'}
                    aria-pressed={patternFocused}
                    onclick={onToggleFocus}
                    title={patternFocused
                        ? 'Exit pattern focus mode (Esc or Ctrl+Shift+F)'
                        : 'Focus pattern editor (Ctrl+Shift+F)'}
                    type="button"
                >
                    <i class="fa fa-{patternFocused ? 'compress' : 'expand'}" aria-hidden="true"></i>
                </button>
                <button
                    class="instrument-edit"
                    onclick={onEditInstrument}
                    title="Edit the selected instrument"
                    type="button"
                    ><i class="fa fa-sliders"></i> Edit instrument
                </button>
            </div>
        </div>
    </div>

    <div
        bind:this={rollEl}
        class="piano-roll"
        aria-label="Piano roll editor"
        oncontextmenu={preventDefault(() => {})}
        onmousedown={handleRollMouseDown}
        onwheel={handleWheel}
        role="grid"
        tabindex="0"
    >
        <div class="piano-roll-header">
            <div class="corner">
                <div class="length-counter" aria-label="Pattern length">{steps} steps</div>
            </div>
            <div
                bind:this={patternTimelineEl}
                style="width: {steps * cellWidth}px;"
                class="timeline"
            >
                {#each Array.from({ length: Math.ceil(steps / 4) }) as _, i (i)}
                    <div style="left: {i * 4 * cellWidth}px" class="time-marker">
                        {i + 1}
                    </div>
                {/each}
                <div
                    style="left: {steps * cellWidth}px;"
                    class="pattern-end-handle"
                    aria-label="Resize pattern length"
                    aria-valuemax="512"
                    aria-valuemin="1"
                    aria-valuenow={steps}
                    onkeydown={handlePatternResizeKeydown}
                    onmousedown={startPatternResize}
                    role="slider"
                    tabindex="0"
                    title="Drag to resize pattern length"
                ></div>
            </div>
        </div>
        <div class="piano-roll-content">
            <div class="side-bar">
                {#each ROW_NOTES as note (note.name)}
                    <div
                        style="height: {cellHeight}px;"
                        class="row-label"
                        class:black={note.black}
                        class:octave={note.name.startsWith('C') && !note.black}
                    >
                        {note.name}
                    </div>
                {/each}
            </div>
            <div
                style="width: {steps * cellWidth}px; height: {ROW_NOTES.length *
                    cellHeight}px; --cell-width: {cellWidth}px;"
                class="grid-container"
            >
                <div class="grid-bg">
                    {#each ROW_NOTES as note (note.name)}
                        <div
                            style="height: {cellHeight}px;"
                            class="grid-row"
                            class:black={note.black}
                            class:octave={note.name.startsWith('C') && !note.black}
                        ></div>
                    {/each}
                </div>

                <div class="notes-layer">
                    {#if selectionRect}
                        <div
                            style="left: {selectionRect.left}px; top: {selectionRect.top}px; width: {selectionRect.width}px; height: {selectionRect.height}px;"
                            class="selection-rect"
                        ></div>
                    {/if}
                    <svg
                        class="legato-layer"
                        aria-hidden="true"
                        height={ROW_NOTES.length * cellHeight}
                        width={steps * cellWidth}
                    >
                        {#each legatoLines as line}
                            <path class="legato-line" d={legatoPath(line.source, line.target)} />
                        {/each}
                    </svg>
                    {#if selectedSlidePair}
                        {@const slideStart =
                            selectedSlidePair.source.start + selectedSlidePair.source.len}
                        {@const slideMidpoint = {
                            left: ((slideStart + selectedSlidePair.target.start) / 2) * cellWidth,
                            top:
                                ((rowOfNote[selectedSlidePair.source.pitch] +
                                    rowOfNote[selectedSlidePair.target.pitch] +
                                    1) /
                                    2) *
                                cellHeight,
                        }}
                        <div
                            style="left: {slideMidpoint.left}px; top: {slideMidpoint.top}px;"
                            class="slide-overlay"
                        >
                            {#if selectedSlidePair.connected}
                                <button
                                    class="slide-action"
                                    aria-expanded={legatoMenuOpen}
                                    aria-label="Edit pitch slide"
                                    onclick={toggleLegatoMenu}
                                    onmousedown={stopPropagation()}
                                    title="Edit pitch slide"
                                    type="button"
                                >
                                    <i class="fa fa-sliders" aria-hidden="true"></i>
                                </button>
                                {#if legatoMenuOpen}
                                    <div
                                        class="slide-menu"
                                        aria-label="Pitch slide options"
                                    >
                                        <select
                                            aria-label="Pitch slide type"
                                            onchange={event => updateLegatoCurve(event.currentTarget.value)}
                                            value={selectedSlidePair.source.legatoTo?.curve || 'linear'}
                                        >
                                            {#each CURVE_SHAPES as shape (shape.id)}
                                                <option value={shape.id}>{shape.label}</option>
                                            {/each}
                                        </select>
                                        <button
                                            class="slide-action"
                                            aria-label="Remove pitch slide"
                                            onclick={removeLegato}
                                            title="Remove pitch slide"
                                            type="button"
                                        >
                                            <i class="fa fa-trash" aria-hidden="true"></i>
                                        </button>
                                    </div>
                                {/if}
                            {:else}
                                <button
                                    class="slide-action"
                                    aria-label="Create pitch slide"
                                    onclick={addLegato}
                                    onmousedown={stopPropagation()}
                                    title="Create pitch slide"
                                    type="button"
                                >
                                    <i class="fa fa-link" aria-hidden="true"></i>
                                </button>
                            {/if}
                        </div>
                    {/if}
                    {#each ghosts as n}
                        {@const r = rowOfNote[n.pitch]}
                        <div
                            style="left: {n.start * cellWidth}px; width: {n.len *
                                cellWidth}px; top: {r * cellHeight + 1}px; height: {cellHeight -
                                2}px;"
                            class="note ghost"
                        ></div>
                    {/each}
                    {#each displayedNotes as n (n)}
                        {@const r = rowOfNote[n.pitch]}
                        {@const v = n.vel ?? 1}
                        <div
                            style="left: {n.start * cellWidth}px; width: {n.len *
                                cellWidth}px; top: {r * cellHeight + 1}px; height: {cellHeight -
                                2}px; background: {pat.color || 'var(--accent)'}; opacity: {0.4 +
                                0.6 * v}"
                            class="note"
                            class:selected={selectedNotes.includes(n)}
                            aria-label={`${n.pitch}, velocity ${Math.round(v * 100)} percent`}
                            ondblclick={stopPropagation(e => openNoteEditor(e as MouseEvent, n))}
                            onkeydown={event => openNoteEditorFromKeyboard(event, n)}
                            onmousedown={stopPropagation(e => {
                                const mouseEvent = e as MouseEvent;
                                const gridPosition = gridPositionAt(mouseEvent);
                                handleMouseDown(mouseEvent, gridPosition.r, gridPosition.s);
                            })}
                            role="button"
                            tabindex="0"
                            title="{n.pitch} • velocity {Math.round(v * 100)}% (Alt+drag)"
                        >
                            <div style="width: {v * 100}%" class="vel-bar"></div>
                            <div
                                style="width: {Math.min(
                                    n.len * cellWidth,
                                    Math.max(8, cellWidth * 0.2),
                                )}px"
                                class="resize-handle"
                            ></div>
                        </div>
                    {/each}
                </div>

                {#if noteEditor}
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (the form stops pointer and Escape events from reaching the spatial editor) -->
                    <form
                        style="left: {noteEditorPosition.left}px; top: {noteEditorPosition.top}px;"
                        class="note-editor"
                        aria-label="Edit note values"
                        onkeydown={onNoteEditorKeydown}
                        onmousedown={stopPropagation()}
                        onsubmit={preventDefault(saveNoteEditor)}
                    >
                        <label>
                            Velocity
                            <div class="velocity-inputs">
                                <input
                                    aria-label="Velocity percentage"
                                    max="100"
                                    min="1"
                                    step="1"
                                    type="range"
                                    bind:value={noteDraft.vel}
                                />
                                <input
                                    bind:this={noteEditorInput}
                                    aria-label="Velocity percentage"
                                    max="100"
                                    min="1"
                                    step="1"
                                    type="number"
                                    bind:value={noteDraft.vel}
                                />
                                <span>%</span>
                            </div>
                        </label>
                        <details class="note-overrides">
                            <summary>Instrument overrides</summary>
                            <div class="note-override-add">
                                <select aria-label="Instrument parameter to override" bind:value={overrideToAdd}>
                                    <option value="">Add parameter…</option>
                                    {#each INSTRUMENT_AUTO_PARAMS as def}
                                        <option disabled={noteDraft.overrides[def.param] !== undefined} value={def.param}>
                                            {def.label}
                                        </option>
                                    {/each}
                                </select>
                                <button onclick={addNoteOverride} type="button">Add</button>
                            </div>
                            {#each INSTRUMENT_AUTO_PARAMS.filter(def => noteDraft.overrides[def.param] !== undefined) as def (def.param)}
                                <label class="note-override-value">
                                    <span>{def.label}</span>
                                    <input
                                        aria-label={`Override ${def.label}`}
                                        inputmode="decimal"
                                        max={def.max}
                                        min={def.min}
                                        step={def.step}
                                        type="number"
                                        bind:value={noteDraft.overrides[def.param]}
                                    />
                                    {#if def.unit}<em>{def.unit}</em>{/if}
                                    <button aria-label={`Clear ${def.label} override`} onclick={() => removeNoteOverride(def.param)} type="button">×</button>
                                </label>
                            {/each}
                        </details>
                        {#if noteEditorError}<small>{noteEditorError}</small>{/if}
                        <div class="note-editor-actions">
                            <button onclick={closeNoteEditor} type="button">Cancel</button>
                            <button type="submit">Apply</button>
                        </div>
                    </form>
                {/if}

                {#if currentPatternPlayheadStep !== null}
                    {#each currentPatternPlayheadSteps as playheadStep, index (`${playheadStep}-${index}`)}
                        <div
                            style="left: {playheadStep * cellWidth}px"
                            class="playhead"
                        ></div>
                    {/each}
                {/if}
            </div>
        </div>
    </div>
</div>

<style>
    .piano-roll-container {
        display: flex;
        flex-direction: column;
        background: var(--color-surface-input);
        border-radius: 8px;
        overflow: hidden;
        min-width: 0;
        user-select: none;
    }

    .piano-roll-container.resizing,
    .piano-roll-container.resizing * {
        cursor: ew-resize !important;
    }

    .piano-roll-container.vel-dragging,
    .piano-roll-container.vel-dragging * {
        cursor: ns-resize !important;
    }

    .piano-roll-container.pattern-resizing,
    .piano-roll-container.pattern-resizing * {
        cursor: ew-resize !important;
    }

    .editor-toolbar {
        min-width: 0;
        background: var(--color-surface);
        border-bottom: 1px solid var(--border);
    }

    .toolbar-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        min-height: 42px;
        min-width: 0;
        box-sizing: border-box;
        padding: 5px 12px;
    }

    .toolbar-hint {
        flex: 1;
        align-self: center;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: center;
        color: var(--color-text-muted);
        font-size: 11px;
    }

    .pattern-controls {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
    }

    .toolbar-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .pattern-focus {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 3px;
        background: transparent;
        color: var(--primary-text);
    }

    .pattern-focus:hover,
    .pattern-focus[aria-pressed='true'] {
        border-color: var(--accent);
        background: var(--color-accent-soft);
        color: var(--accent);
    }

    .pattern-preview {
        flex: 0 0 30px;
        height: 30px;
        border: 1px solid var(--border);
        border-radius: 3px;
        background: transparent;
        color: var(--primary-text);
        cursor: pointer;
    }

    .pattern-preview:hover:not(:disabled) {
        background: var(--color-surface-hover);
    }

    .pattern-preview[aria-pressed='true'] {
        border-color: var(--accent);
        background: var(--color-accent-soft);
        color: var(--accent);
    }

    .pattern-preview:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .piano-roll {
        display: flex;
        flex-direction: column;
        flex: 1;
        height: auto;
        min-height: 0;
        overflow: auto;
        position: relative;
    }

    .piano-roll-header {
        display: flex;
        position: sticky;
        top: 0;
        z-index: 30;
        background: var(--color-surface-input);
        height: 24px;
        border-bottom: 1px solid var(--border);
    }

    .corner {
        width: 88px;
        flex-shrink: 0;
        border-right: 1px solid var(--border);
        background: var(--color-surface);
        position: sticky;
        left: 0;
        z-index: 40;
    }

    .length-counter {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-subtle);
        font-size: 9px;
        font-weight: 700;
    }

    .pattern-end-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        z-index: 2;
        width: 12px;
        padding: 0;
        transform: translateX(-50%);
        border: 0;
        border-left: 2px solid var(--accent);
        background: var(--color-accent-selection);
        cursor: ew-resize;
    }

    .pattern-end-handle:hover,
    .pattern-end-handle:focus-visible {
        background: var(--color-playhead);
        outline: 1px solid var(--accent);
        outline-offset: -1px;
    }

    .timeline {
        flex: 1;
        position: relative;
        background: var(--color-border-subtle);
    }

    .time-marker {
        position: absolute;
        top: 0;
        display: flex;
        align-items: center;
        font-size: 9px;
        color: var(--color-text-subtle);
        padding: 0 4px;
        border-left: 1px solid var(--border);
        height: 100%;
        box-sizing: border-box;
    }

    .piano-roll-content {
        display: flex;
        flex: 1;
    }

    .side-bar {
        position: sticky;
        left: 0;
        z-index: 10;
        background: var(--color-surface-input);
        width: 88px;
        flex-shrink: 0;
        border-right: 1px solid var(--border);
    }

    .row-label {
        font-size: 9px;
        color: var(--color-text-subtle);
        display: flex;
        align-items: center;
        padding-left: 4px;
        border-bottom: 1px solid var(--border-subtle);
        box-sizing: border-box;
    }

    .row-label.octave {
        color: var(--accent2);
        font-weight: bold;
        background: var(--color-border-subtle);
    }

    .row-label.black {
        background: var(--color-canvas-deep);
        color: var(--color-text-faint);
        font-size: 8px;
    }

    .grid-container {
        position: relative;
        background: var(--color-surface-input);
        flex-shrink: 0;
    }

    .grid-bg {
        display: flex;
        flex-direction: column;
        background-image:
            linear-gradient(90deg, var(--border) 1px, transparent 1px),
            linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px),
            linear-gradient(
                90deg,
                color-mix(in srgb, var(--color-border) 27%, transparent) 50%,
                transparent 50%
            );
        background-size:
            calc(var(--cell-width) * 4) 100%,
            var(--cell-width) 100%,
            calc(var(--cell-width) * 8) 100%;
    }

    .grid-row {
        display: flex;
        border-bottom: 1px solid var(--border-subtle);
        box-sizing: border-box;
    }

    .grid-row.black {
        background: var(--color-canvas-deep);
    }

    .grid-row.octave {
        border-bottom: 1px solid var(--border);
    }

    .notes-layer {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
    }

    .note {
        position: absolute;
        background: var(--accent);
        border-radius: 2px;
        pointer-events: auto;
        cursor: move;
        box-sizing: border-box;
        overflow: hidden;
        font-size: 8px;
        padding-left: 2px;
        color: var(--primary-text);
        border: 1px solid rgba(0, 0, 0, 0.2);
    }

    .note.selected {
        filter: brightness(1.3);
        border: 1px solid var(--color-playhead);
        box-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
        z-index: 5;
    }

    .resize-handle {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        cursor: ew-resize;
        z-index: 10;
        background: transparent;
    }

    .resize-handle:hover {
        background: rgba(255, 255, 255, 0.2);
    }

    /* Velocity: the note fades out and its underline shrinks with lower velocity */
    .vel-bar {
        position: absolute;
        left: 0;
        bottom: 0;
        height: 2px;
        background: rgba(255, 255, 255, 0.65);
        pointer-events: none;
    }

    .note.ghost {
        background: #53d8fb44;
        border: 1px solid #53d8fb22;
        pointer-events: none;
        z-index: 1;
    }

    .note-editor {
        position: absolute;
        z-index: 50;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 5px 6px;
        width: 220px;
        padding: 7px;
        border: 1px solid var(--accent);
        border-radius: 5px;
        background: #11111f;
        box-shadow: 0 5px 16px rgba(0, 0, 0, 0.45);
        color: var(--primary-text);
        font-size: 10px;
    }

    .note-editor label {
        display: grid;
        gap: 2px;
    }

    .velocity-inputs {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 48px auto;
        align-items: center;
        gap: 4px;
    }

    .note-editor input[type='number'] {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        padding: 3px 4px;
        border: 1px solid #48485e;
        border-radius: 3px;
        background: var(--surface-input);
        color: var(--primary-text);
        font: inherit;
        appearance: textfield;
        -moz-appearance: textfield;
    }

    .note-editor input[type='range'] {
        width: 100%;
        accent-color: var(--accent);
    }

    .note-overrides {
        grid-column: 1 / -1;
        display: grid;
        gap: 4px;
        padding-top: 3px;
        border-top: 1px solid var(--border-subtle);
    }

    .note-overrides summary {
        cursor: pointer;
        font-size: 10px;
    }

    .note-override-add,
    .note-override-value {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 4px;
    }

    .note-override-add select {
        min-width: 0;
        padding: 2px 3px;
        border: 1px solid var(--color-border);
        border-radius: 3px;
        background: var(--surface-input);
        color: var(--primary-text);
        font: inherit;
    }

    .note-override-value {
        grid-template-columns: minmax(0, 1fr) 58px auto auto;
        font-size: 10px;
    }

    .note-override-value input {
        width: 58px;
    }

    .note-override-value em {
        min-width: 12px;
        font-style: normal;
        opacity: 0.7;
    }

    .note-overrides button {
        padding: 2px 5px;
        border: 1px solid var(--color-border);
        border-radius: 3px;
        background: var(--border);
        color: var(--primary-text);
        font: inherit;
        cursor: pointer;
    }

    .note-editor input::-webkit-outer-spin-button,
    .note-editor input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    .note-editor input:focus {
        border-color: var(--accent);
        outline: none;
    }

    .note-editor small,
    .note-editor-actions {
        grid-column: 1 / -1;
    }

    .note-editor small {
        color: var(--color-error);
    }

    .note-editor-actions {
        display: flex;
        justify-content: flex-end;
        gap: 5px;
    }

    .note-editor-actions button {
        padding: 3px 6px;
        border: 0;
        border-radius: 3px;
        background: var(--border);
        color: var(--primary-text);
        font: inherit;
        cursor: pointer;
    }

    .note-editor-actions button[type='submit'] {
        background: var(--accent);
    }

    .selection-rect {
        position: absolute;
        border: 1px solid var(--accent);
        background: var(--color-accent-selection);
        pointer-events: none;
        z-index: 100;
    }

    .legato-layer {
        position: absolute;
        inset: 0;
        overflow: visible;
        pointer-events: none;
        z-index: 2;
    }

    .legato-line {
        fill: none;
        stroke: var(--accent);
        stroke-width: 2;
        stroke-dasharray: 4 3;
        opacity: 0.9;
    }

    .slide-overlay {
        position: absolute;
        z-index: 6;
        pointer-events: auto;
        transform: translate(-50%, -50%);
    }

    .slide-action {
        display: grid;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 1px solid var(--accent);
        border-radius: 4px;
        background: var(--color-accent-selection);
        color: var(--primary-text);
        cursor: pointer;
        place-items: center;
    }

    .slide-action:hover {
        background: var(--color-accent-soft);
    }

    .slide-action:focus-visible {
        outline: 2px solid var(--accent2);
        outline-offset: 2px;
    }

    .slide-menu {
        position: absolute;
        top: calc(100% + 5px);
        left: 50%;
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 4px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--color-surface);
        box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
        transform: translateX(-50%);
    }

    .slide-menu select {
        width: 76px;
        padding: 3px 4px;
        border: 1px solid var(--border);
        border-radius: 3px;
        background: var(--surface-input);
        color: var(--primary-text);
        font: inherit;
    }

    .playhead {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--color-playhead);
        box-shadow: 0 0 8px var(--color-playhead);
        z-index: 20;
        pointer-events: none;
    }
</style>
