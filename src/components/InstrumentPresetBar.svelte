<script lang="ts">
    import type { PresetBank } from '../lib/instruments';
    import type { Instrument, InstrumentParams } from '../lib/types';

    import {
        createInstrument,
        DEFAULT_PARAMS,
        deleteUserPreset,
        ensurePartials,
        loadUserPresets,
        PRESETS,
        saveUserPreset,
    } from '../lib/instruments';
    import { project, selInstId, touch } from '../lib/project';
    import IconButton from './ui/IconButton.svelte';
    import Prompt from './ui/Prompt.svelte';

    let presetName = $state('Pluck');
    let showSavePreset = $state(false);
    let savePresetValue = $state('');

    let userPresets: PresetBank = $state(loadUserPresets());
    const allPresets = $derived({ ...PRESETS, ...userPresets } as PresetBank);
    const isUserPreset = $derived(presetName in userPresets);
    const inst = $derived(
        ($project?.instruments.find(i => i.id === $selInstId) ||
            $project?.instruments[0]) as Instrument,
    );

    function applyPreset() {
        inst.params = ensurePartials({
            ...DEFAULT_PARAMS,
            ...allPresets[presetName],
        } as InstrumentParams);
        touch();
    }

    function createFromPreset() {
        if (!$project) {
            return;
        }
        const instrument = createInstrument(presetName, allPresets[presetName]);
        $project.instruments = [...$project.instruments, instrument];
        selInstId.set(instrument.id);
    }

    function openSavePreset() {
        savePresetValue = inst.name;
        showSavePreset = true;
    }

    function onSavePreset(value: string) {
        const name = value.trim();
        if (!name) {
            return;
        }
        userPresets = saveUserPreset(name, inst.params);
        presetName = name;
    }

    function removePreset() {
        if (!isUserPreset) {
            return;
        }
        userPresets = deleteUserPreset(presetName);
        presetName = Object.keys(PRESETS)[0];
    }
</script>

<div class="preset-title-controls" aria-label="Preset controls">
    <label>
        <span>Preset</span>
        <select aria-label="Select preset" bind:value={presetName}>
            <optgroup label="Factory">
                {#each Object.keys(PRESETS) as preset (preset)}
                    <option value={preset}>{preset}</option>
                {/each}
            </optgroup>
            {#if Object.keys(userPresets).length}
                <optgroup label="Mine">
                    {#each Object.keys(userPresets) as preset (preset)}
                        <option value={preset}>{preset}</option>
                    {/each}
                </optgroup>
            {/if}
        </select>
    </label>
    <IconButton
        ariaLabel="Apply selected preset"
        icon="fa-check"
        onclick={applyPreset}
        title="Apply selected preset"
    />
    <IconButton
        ariaLabel="Save selected instrument as a preset"
        icon="fa-floppy-disk"
        onclick={openSavePreset}
        title="Save selected instrument as a preset"
    />
    {#if isUserPreset}
        <IconButton
            ariaLabel="Delete selected preset"
            icon="fa-xmark"
            onclick={removePreset}
            title="Delete selected preset"
        />
    {/if}
    <IconButton
        ariaLabel="Create an instrument from this preset"
        icon="fa-add"
        onclick={createFromPreset}
        title="Create an instrument from this preset"
    />
</div>

<Prompt
    label="Preset Name"
    onsubmit={onSavePreset}
    title="Save Preset"
    bind:show={showSavePreset}
    bind:value={savePresetValue}
/>

<style>
    .preset-title-controls {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
    }

    label {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        color: var(--accent2);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
    }

    select {
        width: min(210px, 24vw);
        min-width: 120px;
        padding: 5px 6px;
        background: var(--border);
        border: 0;
        border-radius: 4px;
        color: var(--primary-text);
        font-size: 12px;
        text-transform: none;
    }
</style>
