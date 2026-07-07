<script lang="ts">
    import type {
        PresetBank
    } from '../lib/instruments';
    import type {
        Instrument, InstrumentParams
    } from '../lib/types';

    import {
        createInstrument,
        DEFAULT_PARAMS,
        deleteUserPreset,
        ensurePartials,
        loadUserPresets,
        PRESETS,
        saveUserPreset
    } from '../lib/instruments';
    import {
        project, selInstId, touch
    } from '../lib/project';
    import IconButton from './ui/IconButton.svelte';
    import Prompt from './ui/Prompt.svelte';

    let presetName = $state('Pluck');
    let showSavePreset = $state(false);
    let savePresetValue = $state('');

    let userPresets: PresetBank = $state(loadUserPresets());
    const allPresets = $derived({...PRESETS, ...userPresets} as PresetBank);
    const isUserPreset = $derived(presetName in userPresets);
    const inst = $derived(($project?.instruments.find(i => i.id === $selInstId) || $project?.instruments[0]) as Instrument);

    function applyPreset() {
        inst.params = ensurePartials({...DEFAULT_PARAMS, ...allPresets[presetName]} as InstrumentParams);
        touch();
    }

    function createFromPreset() {
        if (!$project) {return;}
        const instrument = createInstrument(presetName, allPresets[presetName]);
        $project.instruments = [...$project.instruments, instrument];
        selInstId.set(instrument.id);
    }

    function openSavePreset() {
        savePresetValue = inst.name;
        showSavePreset = true;
    }

    function onSavePreset(e: CustomEvent<string>) {
        const name = (e.detail || '').trim();
        if (!name) {return;}
        userPresets = saveUserPreset(name, inst.params);
        presetName = name;
    }

    function removePreset() {
        if (!isUserPreset) {return;}
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
title="Apply selected preset"
                on:click={applyPreset}/>
    <IconButton
ariaLabel="Save selected instrument as a preset"
icon="fa-floppy-disk"
title="Save selected instrument as a preset"
                on:click={openSavePreset}/>
    {#if isUserPreset}
        <IconButton
ariaLabel="Delete selected preset"
icon="fa-xmark"
title="Delete selected preset"
                    on:click={removePreset}/>
    {/if}
    <IconButton
ariaLabel="Create an instrument from this preset"
icon="fa-add"
title="Create an instrument from this preset"
                on:click={createFromPreset}/>
</div>

<Prompt
label="Preset Name"
title="Save Preset"
bind:show={showSavePreset}
bind:value={savePresetValue}
        on:submit={onSavePreset}/>

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
        letter-spacing: .08em;
        text-transform: uppercase;
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

    @media (max-width: 620px) {
        label span {
            display: none;
        }

        select {
            width: min(160px, 42vw);
        }
    }
</style>