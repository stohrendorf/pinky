<script lang="ts">
    import {
        onDestroy
    } from 'svelte';
    import {
        preventDefault 
    } from 'svelte/legacy';
    import {
        get
    } from 'svelte/store';

    import {
        ensureAudio, noteOff, noteOn
    } from '../lib/engine';
    import {
        KEYMAP, NOTES
    } from '../lib/notes';
    import {
        lastPlayedPitch, selectedInstrument
    } from '../lib/project';

    const whiteW = 100 / NOTES.filter(n => !n.black).length;
    const blackW = whiteW * 0.6; // a black key straddles the seam between two white ones
    let whiteIdx = 0;
    const keys = NOTES.map(n => {
        const key = {...n, left: n.black ? whiteIdx * whiteW - blackW / 2 : 0};
        if (!n.black) {
            whiteIdx++;
        }
        return key;
    });

    let active: Record<string, boolean> = $state({});
    let mouseDown = $state(false);
    let replayName: string | null = null;
    let spaceHeld = false;

    async function press(name: string) {
        lastPlayedPitch.set(name);
        await ensureAudio();
        const inst = selectedInstrument();
        noteOn('live-' + inst.id, name, inst.params);
        active = {...active, [name]: true};
    }

    function release(name: string) {
        const inst = selectedInstrument();
        noteOff('live-' + inst.id, name);
        active = {...active, [name]: false};
    }

    function isTextEntry(e: KeyboardEvent) {
        const target = e.target as HTMLElement;
        return (target instanceof HTMLInputElement && target.type !== 'range')
            || target instanceof HTMLSelectElement
            || target instanceof HTMLTextAreaElement
            || target.isContentEditable;
    }

    async function replayLastNote() {
        const name = get(lastPlayedPitch);
        replayName = name;
        await press(name);
        if (!spaceHeld || replayName !== name) {
            release(name);
        }
    }

    function releaseLastNote() {
        spaceHeld = false;
        if (!replayName) {
            return;
        }
        release(replayName);
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
        const n = KEYMAP[e.key.toLowerCase()];
        if (n) {
            press(n);
        }
    }

    function onKeyup(e: KeyboardEvent) {
        if (e.key === ' ' && !isTextEntry(e)) {
            e.preventDefault();
            e.stopPropagation();
            releaseLastNote();
            return;
        }
        const n = KEYMAP[e.key.toLowerCase()];
        if (n) {
            release(n);
        }
    }

    onDestroy(() => {
        releaseLastNote();
    });
</script>

<svelte:window
onkeydowncapture={onKeydown}
               onkeyup={onKeyup}
               onmousedown={() => mouseDown = true}
               onmouseup={() => mouseDown = false}/>

<div class="keyboard">
    {#each keys as k (k.name)}
        <div
style={k.black ? `left:${k.left}%; width:${blackW}%` : ''}
             class="key {k.black ? 'black' : 'white'}"
             class:active={active[k.name]}
             aria-label="Play {k.name}"
             onmousedown={preventDefault(() => press(k.name))}
             onmouseenter={() => mouseDown && press(k.name)}
             onmouseleave={() => active[k.name] && release(k.name)}
             onmouseup={() => release(k.name)}
             role="button"
             tabindex="-1">
            {k.name}
        </div>
    {/each}
</div>

<style>
    .keyboard {
        display: flex;
        position: relative;
        height: 72px;
        margin: 12px 0;
        user-select: none;
        background: #1b1b2b;
        border-radius: 8px;
        overflow: hidden;
    }

    .key {
        border-radius: 0 0 6px 6px;
        cursor: pointer;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding-bottom: 4px;
        font-size: 10px;
        overflow: hidden;
        transition: background 0.1s;
    }

    .white {
        background: #ececf2;
        color: #333;
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
        background: #ffaa44;
        color: var(--primary-text);
    }
</style>
