// Note editing operations of the piano roll — shared by the mouse handlers and
import type {
    Writable
} from 'svelte/store';

// the keyboard shortcuts (tracker workflow: copy/paste, duplicate, transpose,
// nudge, velocity).
import {
    get, writable
} from 'svelte/store';

import type {
    Note, Pattern
} from './types';

import {
    isLegatoTarget
} from './legato';
import {
    idxOfNote, NOTES
} from './notes';
import {
    project, selInstId, selPatId, touch, trackNotes
} from './project';


// Where the next paste lands (in steps) — set by clicking in the piano roll.
export const editStep: Writable<number> = writable(0);
export const hasClipboard: Writable<boolean> = writable(false);

let clipboard: Note[] = []; // starts normalized to 0

export const VEL_MIN = 0.05;
export const clampVel = (v: number): number => Math.max(VEL_MIN, Math.min(1, v));

function curPattern(): Pattern | null {
    const p = get(project);
    if (!p) {
        return null;
    }
    return p.patterns.find(pt => pt.id === get(selPatId)) || p.patterns[0] || null;
}

// The note list currently shown in the piano roll (selected pattern + instrument)
export function curNotes(): Note[] | null {
    const pat = curPattern();
    const inst = get(selInstId);
    if (!pat || !inst) {
        return null;
    }
    return trackNotes(pat, inst);
}

const selectedOf = (notes: Note[]): Note[] => notes.filter(n => n.selected);

export function removeInvalidLegatoLinks(notes: Note[]): void {
    notes.forEach(source => {
        if (!source.legatoTo) {
            return;
        }
        const target = notes.find(note => note.start === source.legatoTo?.start && note.pitch === source.legatoTo.pitch);
        if (!target || !isLegatoTarget(source, target.start)) {
            delete source.legatoTo;
        }
    });
}

export function updateLegatoTargets(
    notes: Note[],
    originalPositions: Map<Note, Pick<Note, 'pitch' | 'start'>>,
    originalLegatoTargets: ReadonlyMap<Note, Pick<NonNullable<Note['legatoTo']>, 'pitch' | 'start'>>
): void {
    const movedTargets = new Map<string, Note>();
    originalPositions.forEach((position, note) => {
        movedTargets.set(`${position.pitch}:${position.start}`, note);
    });
    notes.forEach(note => {
        const link = note.legatoTo;
        if (!link) {
            return;
        }
        const originalTarget = originalLegatoTargets.get(note) ?? link;
        const target = movedTargets.get(`${originalTarget.pitch}:${originalTarget.start}`);
        if (!target) {
            return;
        }
        link.pitch = target.pitch;
        link.start = target.start;
    });
    removeInvalidLegatoLinks(notes);
}

export function createLegatoBetweenSelected(): boolean {
    const notes = curNotes();
    if (!notes) {
        return false;
    }
    const selected = selectedOf(notes).sort((a, b) => a.start - b.start || idxOfNote[a.pitch] - idxOfNote[b.pitch]);
    if (selected.length !== 2 || !isLegatoTarget(selected[0], selected[1].start)) {
        return false;
    }
    selected[0].legatoTo = {pitch: selected[1].pitch, start: selected[1].start};
    touch();
    return true;
}

export function selectAllNotes(): void {
    const notes = curNotes();
    if (!notes) {
        return;
    }
    notes.forEach(n => n.selected = true);
    touch();
}

export function clearNoteSelection(): void {
    const notes = curNotes();
    if (!notes) {
        return;
    }
    notes.forEach(n => n.selected = false);
    touch();
}

export function deleteSelectedNotes(): void {
    const notes = curNotes();
    if (!notes) {
        return;
    }
    const keep = notes.filter(n => !n.selected);
    if (keep.length === notes.length) {
        return;
    }
    notes.splice(0, notes.length, ...keep);
    touch();
}

export function copySelectedNotes(): number {
    const notes = curNotes();
    if (!notes) {
        return 0;
    }
    const sel = selectedOf(notes);
    if (!sel.length) {
        return 0;
    }
    const base = Math.min(...sel.map(n => n.start));
    clipboard = sel.map(n => ({pitch: n.pitch, start: n.start - base, len: n.len, vel: n.vel}));
    hasClipboard.set(true);
    return clipboard.length;
}

export function cutSelectedNotes(): void {
    if (copySelectedNotes()) {
        deleteSelectedNotes();
    }
}

// Paste at the edit cursor (last click in the roll), keeping relative timing.
export function pasteNotes(): void {
    const notes = curNotes();
    if (!notes || !clipboard.length) {
        return;
    }
    const at = Math.max(0, get(editStep));
    notes.forEach(n => n.selected = false);
    clipboard.forEach(c => notes.push({...c, start: at + c.start, selected: true}));
    touch();
}

// Ctrl+D: copy the selection right behind itself (classic tracker gesture)
export function duplicateSelectedNotes(): void {
    const notes = curNotes();
    if (!notes) {
        return;
    }
    const sel = selectedOf(notes);
    if (!sel.length) {
        return;
    }
    const from = Math.min(...sel.map(n => n.start));
    const to = Math.max(...sel.map(n => n.start + n.len));
    const shift = Math.max(1, to - from);
    const copies = sel.map(n => ({pitch: n.pitch, start: n.start + shift, len: n.len, vel: n.vel, selected: true}));
    sel.forEach(n => n.selected = false);
    copies.forEach(c => notes.push(c));
    touch();
}

export function transposeSelectedNotes(semis: number): void {
    const notes = curNotes();
    if (!notes) {
        return;
    }
    const sel = selectedOf(notes);
    if (!sel.length) {
        return;
    }
    // move as a block: bail out instead of squashing notes at the ends
    const rows = sel.map(n => idxOfNote[n.pitch] ?? 0);
    if (Math.min(...rows) + semis < 0 || Math.max(...rows) + semis > NOTES.length - 1) {
        return;
    }
    sel.forEach(n => n.pitch = NOTES[(idxOfNote[n.pitch] ?? 0) + semis].name);
    touch();
}

export function nudgeSelectedNotes(steps: number): void {
    const notes = curNotes();
    if (!notes) {
        return;
    }
    const sel = selectedOf(notes);
    if (!sel.length) {
        return;
    }
    if (Math.min(...sel.map(n => n.start)) + steps < 0) {
        return;
    }
    sel.forEach(n => n.start += steps);
    touch();
}

export function velocitySelectedNotes(delta: number): void {
    const notes = curNotes();
    if (!notes) {
        return;
    }
    const sel = selectedOf(notes);
    if (!sel.length) {
        return;
    }
    sel.forEach(n => n.vel = clampVel((n.vel ?? 1) + delta));
    touch();
}
