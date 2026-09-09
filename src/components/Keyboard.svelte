<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { SvelteMap } from 'svelte/reactivity';
    import { get } from 'svelte/store';

    import {
        bindingForCode,
        COMPUTER_KEY_BINDINGS,
        computerKeySource,
        HeldNoteSources,
        learnKeyboardLabel,
        loadKeyboardLayout,
        MAX_PREVIEW_OCTAVE,
        MIN_PREVIEW_OCTAVE,
    } from '../lib/computer-keyboard';
    import { ensureAudio, noteOff, noteOn } from '../lib/engine';
    import { NOTES } from '../lib/notes';
    import { lastPlayedPitch, selectedInstrument } from '../lib/project';

    const POINTER_SOURCE = 'pointer';
    const SPACE_SOURCE = 'space';
    const heldNotes = new HeldNoteSources();
    const pendingSources = new SvelteMap<string, string>();

    let octave = $state(5);
    let active: Record<string, boolean> = $state({});
    let mouseDown = $state(false);
    let replayName: string | null = null;
    let spaceHeld = false;

    const keys = $derived.by(() => {
        const visible = NOTES.slice((octave - 1) * 12, (octave + 2) * 12);
        const whiteWidth = 100 / visible.filter(note => !note.black).length;
        const blackWidth = whiteWidth * 0.6;
        let whiteIndex = 0;
        return visible.map(note => {
            const key = {
                ...note,
                left: note.black ? whiteIndex * whiteWidth - blackWidth / 2 : 0,
                blackWidth,
            };
            if (!note.black) {
                whiteIndex++;
            }
            return key;
        });
    });
    const computerLabels = new SvelteMap(
        COMPUTER_KEY_BINDINGS.map(binding => [binding.code, binding.character]),
    );
    const labelsByNote = $derived.by(() => {
        const labels: Record<string, string> = {};
        for (const binding of COMPUTER_KEY_BINDINGS) {
            const mapped = bindingForCode(binding.code, octave);
            if (mapped) {
                labels[mapped.note] = computerLabels.get(binding.code) ?? binding.character;
            }
        }
        return labels;
    });

    function syncActive() {
        active = Object.fromEntries(heldNotes.activeNotes().map(note => [note, true]));
    }

    async function press(source: string, name: string) {
        if (pendingSources.has(source) || heldNotes.hasSource(source)) {
            return;
        }
        pendingSources.set(source, name);
        lastPlayedPitch.set(name);
        try {
            await ensureAudio();
        } catch (error) {
            pendingSources.delete(source);
            throw error;
        }
        if (pendingSources.get(source) !== name) {
            return;
        }
        pendingSources.delete(source);
        const inst = selectedInstrument();
        if (heldNotes.hold(source, { instrumentId: inst.id, note: name })) {
            noteOn('live-' + inst.id, name, inst.params);
        }
        syncActive();
    }

    function releaseSource(source: string) {
        pendingSources.delete(source);
        const voice = heldNotes.release(source);
        if (voice) {
            noteOff('live-' + voice.instrumentId, voice.note);
        }
        syncActive();
    }

    function releaseAll() {
        pendingSources.clear();
        for (const voice of heldNotes.drain()) {
            noteOff('live-' + voice.instrumentId, voice.note);
        }
        active = {};
        mouseDown = false;
        replayName = null;
        spaceHeld = false;
    }

    function changeOctave(delta: number) {
        const next = Math.max(MIN_PREVIEW_OCTAVE, Math.min(MAX_PREVIEW_OCTAVE, octave + delta));
        if (next === octave) {
            return;
        }
        releaseAll();
        octave = next;
    }

    function isTextEntry(e: KeyboardEvent) {
        const target = e.target as HTMLElement;
        return (
            (target instanceof HTMLInputElement && target.type !== 'range') ||
            target instanceof HTMLSelectElement ||
            target instanceof HTMLTextAreaElement ||
            target.isContentEditable
        );
    }

    async function replayLastNote() {
        const name = get(lastPlayedPitch);
        replayName = name;
        await press(SPACE_SOURCE, name);
        if (!spaceHeld || replayName !== name) {
            releaseSource(SPACE_SOURCE);
        }
    }

    function releaseLastNote() {
        spaceHeld = false;
        if (!replayName) {
            return;
        }
        releaseSource(SPACE_SOURCE);
        replayName = null;
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === ' ' && !isTextEntry(e)) {
            e.preventDefault();
            e.stopPropagation();
            if (!e.repeat) {
                spaceHeld = true;
                replayLastNote();
            }
            return;
        }
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        } // leave Ctrl+Z & friends to the shortcuts
        if (isTextEntry(e)) {
            return;
        }
        learnKeyboardLabel(computerLabels, e.code, e.key);
        const binding = bindingForCode(e.code, octave);
        if (binding) {
            press(computerKeySource(e.key, e.code), binding.note);
        }
    }

    function onKeyup(e: KeyboardEvent) {
        if (e.key === ' ') {
            if (!isTextEntry(e) || spaceHeld || replayName !== null) {
                e.preventDefault();
                e.stopPropagation();
                releaseLastNote();
            }
            return;
        }
        releaseSource(computerKeySource(e.key, e.code));
    }

    function onMouseUp() {
        mouseDown = false;
        releaseSource(POINTER_SOURCE);
    }

    function onPointerDown(e: MouseEvent, name: string) {
        e.preventDefault();
        press(POINTER_SOURCE, name);
    }

    onMount(() => {
        void loadKeyboardLayout(computerLabels);
    });
    onDestroy(releaseAll);
</script>

<svelte:window
    onblur={releaseAll}
    onkeydowncapture={onKeydown}
    onkeyup={onKeyup}
    onmousedown={() => (mouseDown = true)}
    onmouseup={onMouseUp}
/>

<div class="keyboard-header">
    <div class="octave-controls" aria-label="Preview octave range">
        <button
            aria-label="Octave down"
            disabled={octave === MIN_PREVIEW_OCTAVE}
            onclick={() => changeOctave(-1)}
            title="Shift preview down one octave"
            type="button"
            >−
        </button>
        <strong>Range C{octave - 1}–B{octave + 1}</strong>
        <button
            aria-label="Octave up"
            disabled={octave === MAX_PREVIEW_OCTAVE}
            onclick={() => changeOctave(1)}
            title="Shift preview up one octave"
            type="button"
            >+
        </button>
    </div>
    <span>Space replays the last note</span>
</div>

<div class="keyboard">
    {#each keys as k (k.name)}
        <div
            style={k.black ? `left:${k.left}%; width:${k.blackWidth}%` : ''}
            class="key {k.black ? 'black' : 'white'}"
            class:active={active[k.name]}
            aria-label="Play {k.name}"
            aria-pressed={active[k.name] ?? false}
            onmousedown={e => onPointerDown(e, k.name)}
            onmouseenter={() => mouseDown && press(POINTER_SOURCE, k.name)}
            onmouseleave={() => mouseDown && releaseSource(POINTER_SOURCE)}
            onmouseup={() => releaseSource(POINTER_SOURCE)}
            role="button"
            tabindex="-1"
        >
            {#if labelsByNote[k.name]}<kbd class="computer-key">{labelsByNote[k.name]}</kbd>{/if}
            <span class="note-name">{k.name}</span>
        </div>
    {/each}
</div>

<style>
    .keyboard-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 12px;
        color: var(--secondary-text);
        font-size: 11px;
    }

    .octave-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
    }

    .octave-controls button {
        width: 24px;
        height: 24px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 3px;
        background: var(--color-surface-input);
        color: var(--primary-text);
        cursor: pointer;
    }

    .octave-controls button:disabled {
        cursor: default;
        opacity: 0.4;
    }

    .keyboard {
        display: flex;
        position: relative;
        height: 72px;
        margin: 6px 0 12px;
        user-select: none;
        background: var(--color-canvas-deep);
        border: 1px solid var(--border);
        border-radius: 2px;
        overflow: hidden;
    }

    .key {
        border-radius: 0;
        cursor: pointer;
        display: flex;
        align-items: flex-end;
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        padding-bottom: 4px;
        font-size: 10px;
        overflow: hidden;
        transition: background 0.1s;
    }

    .computer-key {
        min-width: 13px;
        padding: 1px 2px;
        border: 1px solid currentColor;
        border-radius: 2px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-weight: 700;
        line-height: 1;
        text-transform: uppercase;
    }

    .note-name {
        line-height: 1;
    }

    .white {
        background: #ede9e7;
        color: #282326;
        flex: 1;
        border: 1px solid #555;
        position: relative;
        z-index: 1;
    }

    .white.active {
        background: var(--accent);
        color: var(--primary-text);
    }

    .black {
        background: #222;
        color: #aaa;
        height: 60%;
        position: absolute;
        z-index: 2;
        top: 0;
        border-radius: 0 0 4px 4px;
        border: 1px solid #000;
        font-size: 8px;
    }

    .black.active {
        background: var(--color-accent);
        color: var(--primary-text);
    }
</style>
