<script lang="ts">
    import {
        untrack
    } from 'svelte';

    import type {
        NamedTreeItem
    } from '../lib/name-tree';
    import type {
        Project
    } from '../lib/types';

    import {
        autoParams,
        INSTRUMENT_AUTO_GROUPS,
        MASTER_TARGET,
        mixerTarget,
        parseMixerTarget,
        type AutoParamGroup
    } from '../lib/automation';
    import TreeView from './ui/TreeView.svelte';

    interface Props {
        project: Project;
        onadd?: (target: string, param: string) => void;
    }

    const {project, onadd = () => {}}: Props = $props();
    const initialTarget = untrack(() => project.instruments[0]?.id || MASTER_TARGET);
    let tab: 'instrument' | 'mixer' | 'global' = $state('instrument');
    let target = $state(initialTarget);
    let param = $state(autoParams(initialTarget)[0]?.param || '');

    const mixerItems = $derived([
        ...project.instruments.filter(instrument => !!project.mixer?.channels[instrument.id]).map(instrument => ({
            id: mixerTarget('channel', instrument.id), name: `${instrument.name} channel`, color: instrument.color
        })),
        ...(project.mixer?.buses.map(bus => ({
            id: mixerTarget('bus', bus.id), name: `Buses/${bus.name}`, color: '#a29bfe'
        })) || [])
    ] satisfies NamedTreeItem[]);
    const parameterGroups = $derived.by((): AutoParamGroup[] => {
        if (tab === 'instrument') {return INSTRUMENT_AUTO_GROUPS;}
        let params = autoParams(target);
        const parsed = parseMixerTarget(target);
        if (parsed?.kind === 'bus' && project.mixer?.buses.find(bus => bus.id === parsed.id)?.effect !== 'delay') {
            params = params.filter(def => def.param !== 'delayTime' && def.param !== 'feedback');
        }
        return [{title: tab === 'global' ? 'Master' : 'Channel strip', params}];
    });
    const duplicate = $derived(project.automation?.find(lane => lane.target === target && lane.param === param));

    function choose(nextTarget: string) {
        target = nextTarget;
        param = parameterGroups.flatMap(group => group.params)[0]?.param || autoParams(target)[0]?.param || '';
    }

    function chooseTab(next: typeof tab) {
        tab = next;
        if (next === 'instrument') {choose(project.instruments[0]?.id || '');}
        else if (next === 'mixer') {choose(mixerItems[0]?.id || '');}
        else {choose(MASTER_TARGET);}
    }

    function add() {
        if (param && !duplicate) {onadd(target, param);}
    }
</script>

<div class="automation-picker">
    <div class="target-tabs" aria-label="Automation target type" role="tablist">
        <button
class:active={tab === 'instrument'}
aria-selected={tab === 'instrument'}
onclick={() => chooseTab('instrument')}
role="tab"
type="button">Instruments</button>
        <button
class:active={tab === 'mixer'}
aria-selected={tab === 'mixer'}
onclick={() => chooseTab('mixer')}
role="tab"
type="button">Mixer</button>
        <button
class:active={tab === 'global'}
aria-selected={tab === 'global'}
onclick={() => chooseTab('global')}
role="tab"
type="button">Global FX</button>
    </div>

    <div class="picker-grid">
        <div class="targets" role="tabpanel">
            {#if tab === 'instrument'}
                <TreeView items={project.instruments} onselect={choose} selectedId={target} title="Instruments"/>
            {:else if tab === 'mixer'}
                <TreeView
emptyLabel="No mixer channels"
items={mixerItems}
onselect={choose}
selectedId={target}
title="Channels and buses"/>
            {:else}
                <button class="global-target selected" onclick={() => choose(MASTER_TARGET)} type="button">
                    <i class="fa fa-sliders" aria-hidden="true"></i> Master FX
                </button>
            {/if}
        </div>

        <div class="parameters" aria-label="Automation parameters">
            {#each parameterGroups as group (group.title)}
                {#if group.params.length}
                    <fieldset>
                        <legend>{group.title}</legend>
                        <div class="parameter-list">
                            {#each group.params as def (def.param)}
                                <button
class:selected={param === def.param}
aria-pressed={param === def.param}
onclick={() => param = def.param}
type="button">
                                    <span>{def.label}</span>
                                    {#if def.unit}<small>{def.unit}</small>{/if}
                                </button>
                            {/each}
                        </div>
                    </fieldset>
                {/if}
            {/each}
            {#if !parameterGroups.some(group => group.params.length)}
                <p class="empty">Choose a target with automatable controls.</p>
            {/if}
        </div>
    </div>

    <div class="picker-footer">
        <span>{duplicate ? 'This lane already exists.' : 'Starts at the control’s current value.'}</span>
        <button class="add-lane" disabled={!param || !!duplicate} onclick={add} type="button">Add lane</button>
    </div>
</div>

<style>
    .automation-picker {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 390px;
    }

    .target-tabs {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--border);
    }

    .target-tabs button {
        padding: 8px 12px;
        background: transparent;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--secondary-text);
        cursor: pointer;
    }

    .target-tabs button.active {
        border-bottom-color: var(--accent);
        color: var(--primary-text);
    }

    .picker-grid {
        display: grid;
        grid-template-columns: minmax(190px, .8fr) minmax(280px, 1.2fr);
        gap: 12px;
        flex: 1;
        min-height: 0;
    }

    .targets {
        height: 330px;
    }

    .targets, .parameters {
        min-height: 0;
    }

    .parameters {
        overflow: auto;
        padding-right: 4px;
    }

    fieldset {
        margin: 0 0 10px;
        padding: 0;
        border: 0;
    }

    legend {
        margin-bottom: 5px;
        color: var(--color-text-muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
    }

    .parameter-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 4px;
    }

    .parameter-list button, .global-target {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 34px;
        padding: 7px 9px;
        background: var(--color-surface-input);
        border: 1px solid var(--border);
        color: var(--primary-text);
        text-align: left;
        cursor: pointer;
    }

    .parameter-list button.selected, .global-target.selected {
        border-color: var(--accent);
        background: var(--color-accent-soft);
    }

    .parameter-list small {
        color: var(--secondary-text);
    }

    .global-target {
        width: 100%;
        justify-content: flex-start;
    }

    .empty, .picker-footer {
        color: var(--secondary-text);
        font-size: 11px;
    }

    .picker-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-top: 10px;
        border-top: 1px solid var(--border);
    }

    .add-lane {
        padding: 7px 14px;
    }

    button:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

</style>