<script lang="ts">
    import {
        createEventDispatcher
    } from 'svelte';

    interface Props {
        value?: string;
    }

    let { value = $bindable('#53d8fb') }: Props = $props();
    const dispatch = createEventDispatcher<{change: string}>();

    const presets = [
        '#53d8fb', '#ff9f43', '#ee5253', '#10ac84', '#5f27cd', '#0abde3', '#ff6b6b', '#48dbfb',
        '#f368e0', '#feca57', '#1dd1a1', '#ff9ff3', '#00d2d3', '#54a0ff', '#341f97', '#222f3e'
    ];

    function select(c: string) {
        value = c;
        dispatch('change', value);
    }
</script>

<div class="color-picker">
    <div style="background: {value}" class="preview"></div>
    <div class="grid">
        {#each presets as c}
            <button
                    style="background: {c}"
                    class="swatch"
                    class:active={value === c}
                    onclick={() => select(c)}></button>
        {/each}
    </div>
    <div class="hex-input">
        <label>Hex:</label>
        <input oninput={() => dispatch('change', value)} type="text" bind:value/>
    </div>
</div>

<style>
    .color-picker {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
    }

    .preview {
        height: 40px;
        border-radius: 4px;
        border: 1px solid var(--border);
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 6px;
    }

    .swatch {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 4px;
        border: 2px solid transparent;
        cursor: pointer;
        padding: 0;
        transition: transform 0.1s;
    }

    .swatch:hover {
        transform: scale(1.1);
    }

    .swatch.active {
        border-color: var(--color-playhead);
        box-shadow: 0 0 8px rgba(255, 255, 255, .3);
    }

    .hex-input {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .hex-input label {
        font-size: 11px;
        color: var(--color-text-muted);
        text-transform: uppercase;
    }

    .hex-input input {
        background: var(--color-surface-input);
        border: 1px solid var(--border);
        color: var(--primary-text);
        flex: 1;
        padding: 6px 10px;
        font-family: monospace;
        border-radius: 4px;
        outline: none;
        font-size: 13px;
    }

    .hex-input input:focus {
        border-color: var(--accent);
    }
</style>
