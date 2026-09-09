// Global keyboard shortcuts (see Shortcuts.svelte for the cheat sheet dialog)
import type {
    Writable
} from 'svelte/store';

import {
    get, writable
} from 'svelte/store';

import {
    redo, undo
} from './history';
import {
    clearNoteSelection,
    copySelectedNotes,
    cutSelectedNotes,
    deleteSelectedNotes,
    duplicateSelectedNotes,
    nudgeSelectedNotes,
    pasteNotes,
    selectAllNotes,
    transposeSelectedNotes,
    velocitySelectedNotes
} from './noteops';
import {
    playing, saveProject
} from './project';
import {
    exportWav
} from './render';
import {
    playPattern, playSong, seekSong, stopTransport
} from './transport';

export const showShortcuts: Writable<boolean> = writable(false);

export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
    {
        title: 'Transport',
        items: [
            ['Space', 'Play / stop the song'],
            ['Shift + Space', 'Play / stop the selected pattern'],
            ['Home', 'Playback cursor back to the start'],
            ['Media buttons', 'Play song, play pattern, reset cursor, or stop']
        ]
    },
    {
        title: 'Project',
        items: [
            ['Ctrl + Z', 'Undo'],
            ['Ctrl + Shift + Z', 'Redo (also Ctrl + Y)'],
            ['Ctrl + S', 'Save to the browser'],
            ['Ctrl + E', 'Render the song to a WAV file'],
            ['?', 'This cheat sheet']
        ]
    },
    {
        title: 'Piano roll',
        items: [
            ['Ctrl + A', 'Select all notes of the instrument'],
            ['Ctrl + C / X / V', 'Copy / cut / paste notes (paste at the last click)'],
            ['Ctrl + D', 'Duplicate the selection right behind itself'],
            ['Delete', 'Delete the selected notes'],
            ['↑ / ↓', 'Transpose a semitone (Shift = an octave)'],
            ['← / →', 'Nudge by a step (Shift = a beat)'],
            ['Alt + ↑ / ↓', 'Louder / quieter (velocity)'],
            ['Alt + drag', 'Set velocity'],
            ['Esc', 'Clear the note selection']
        ]
    },
    {
        title: 'Automation',
        items: [
            ['Automation button', 'Add a lane for an instrument or master param'],
            ['Click the curve', 'Add a point (and drag it)'],
            ['Drag a point', 'Move it in time / value'],
            ['Right-click a point', 'Remove it'],
            ['× on the lane', 'Remove the whole lane']
        ]
    },
    {
        title: 'Mixing',
        items: [
            ['M / S on an instrument', 'Mute / solo that instrument'],
            ['M / S on a lane', 'Mute / solo that arranger lane']
        ]
    },
    {
        title: 'Mouse',
        items: [
            ['Ctrl + wheel', 'Zoom (piano roll & arranger)'],
            ['Middle-drag', 'Pan the view'],
            ['Alt + wheel (arranger)', 'Transpose the selected clips (Shift = an octave)'],
            ['Timeline click / drag', 'Place the playback cursor / mark a loop'],
            ['Timeline right-click', 'Clear the loop region'],
            ['Z .. M, Q .. U', 'Play the selected instrument live']
        ]
    }
];

function togglePlay(pattern: boolean): void {
    if (get(playing)) {
        stopTransport();
        return;
    }
    if (pattern) {
        playPattern();
    } else {
        playSong();
    }
}

export function handleShortcut(e: KeyboardEvent): void {
    if (e.key === 'MediaPlayPause' || e.key === 'MediaPlay') {
        e.preventDefault();
        if (get(playing)) {
            stopTransport();
        } else {
            playSong();
        }
        return;
    }
    if (e.key === 'MediaTrackNext') {
        e.preventDefault();
        playPattern();
        return;
    }
    if (e.key === 'MediaTrackPrevious') {
        e.preventDefault();
        seekSong(0);
        return;
    }
    if (e.key === 'MediaStop') {
        e.preventDefault();
        stopTransport();
        return;
    }

    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t?.isContentEditable) {
        return;
    }

    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (ctrl && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
            redo();
        } else {
            undo();
        }
        return;
    }
    if (ctrl && k === 'y') {
        e.preventDefault();
        redo();
        return;
    }
    if (ctrl && k === 's') {
        e.preventDefault();
        saveProject();
        return;
    }
    if (ctrl && k === 'e') {
        e.preventDefault();
        exportWav();
        return;
    }
    if (ctrl && k === 'a') {
        e.preventDefault();
        selectAllNotes();
        return;
    }
    if (ctrl && k === 'c') {
        e.preventDefault();
        copySelectedNotes();
        return;
    }
    if (ctrl && k === 'x') {
        e.preventDefault();
        cutSelectedNotes();
        return;
    }
    if (ctrl && k === 'v') {
        e.preventDefault();
        pasteNotes();
        return;
    }
    if (ctrl && k === 'd') {
        e.preventDefault();
        duplicateSelectedNotes();
        return;
    }
    if (e.altKey && !ctrl && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        velocitySelectedNotes(e.key === 'ArrowUp' ? 0.1 : -0.1);
        return;
    }
    if (ctrl || e.altKey) {
        return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        transposeSelectedNotes((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
        return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        nudgeSelectedNotes((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 4 : 1));
        return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedNotes();
        return;
    }
    if (e.key === 'Escape') {
        clearNoteSelection();
        return;
    }

    if (e.key === ' ') {
        e.preventDefault();
        togglePlay(e.shiftKey);
        return;
    }
    if (e.key === 'Home') {
        e.preventDefault();
        seekSong(0);
        return;
    }
    if (e.key === '?') {
        e.preventDefault();
        showShortcuts.update(v => !v);
    }
}
