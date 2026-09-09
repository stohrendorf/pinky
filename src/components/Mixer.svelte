<script lang="ts">
    import {
        onMount, tick
    } from 'svelte';

    import type {
        MixerBus, MixerChannel, MixerMaster, MixerState
    } from '../lib/mixer';

    import {
        mixerMeters
    } from '../lib/engine';
    import {
        addMixerBus, canRoute, ensureMixer, MAX_MIXER_BUSES, removeMixerBus, resolveMixer
    } from '../lib/mixer';
    import {
        project, touch
    } from '../lib/project';
    import {
        rendering
    } from '../lib/render';
    import MixerFader from './MixerFader.svelte';
    import MixerStrip from './MixerStrip.svelte';

    // touch() publishes in-place edits; fresh values also invalidate strip props.
    const mixer = $derived(structuredClone(resolveMixer($project?.mixer, $project?.instruments.map(inst => inst.id) ?? [])));
    const strips = $derived([
        ...($project?.instruments ?? []).map(inst => ({
            id: inst.id, name: inst.name, color: inst.color, kind: 'Instrument', channel: mixer.channels[inst.id]
        })),
        ...mixer.buses.map(bus => ({
            id: bus.id,
            name: bus.name,
            color: 'var(--accent2)',
            kind: bus.effect === 'delay' ? 'Delay return' : 'Group bus',
            channel: bus
        }))
    ]);
    let selectedId = $state('');
    const selected = $derived(strips.find(strip => strip.id === selectedId));
    const selectedBus = $derived(mixer.buses.find(bus => bus.id === selected?.id));
    let root: HTMLDivElement;
    let details = $state<HTMLElement>();
    const silence = {master: {peak: [0, 0], rms: [0, 0], reduction: 0}, channels: {}};
    let meters = $state<ReturnType<typeof mixerMeters>>(silence);

    onMount(() => {
        const timer = setInterval(() => {
            meters = $rendering ? silence : mixerMeters();
        }, 1000 / 15);
        const dialog = root.closest<HTMLElement>('[role="dialog"]');
        const trapFocus = (event: KeyboardEvent) => {
            if (event.key !== 'Tab' || !dialog) {
                return;
            }
            const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex="0"]')]
                .filter(el => !el.matches(':disabled') && el.checkVisibility());
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };
        dialog?.addEventListener('keydown', trapFocus);
        return () => {
            clearInterval(timer);
            dialog?.removeEventListener('keydown', trapFocus);
        };
    });

    function edit(change: (state: MixerState) => void) {
        if (!$project || $rendering) {
            return;
        }
        change(ensureMixer($project));
        touch();
    }

    function editChannel(id: string, change: (channel: MixerChannel) => void) {
        edit(state => {
            const channel = state.channels[id] ?? state.buses.find(bus => bus.id === id);
            if (channel) {
                change(channel);
            }
        });
    }

    function numeric(input: HTMLInputElement, min: number, max: number, change: (value: number) => void) {
        const value = input.valueAsNumber;
        if (Number.isFinite(value)) {
            change(Math.max(min, Math.min(max, value)));
        }
    }

    function masterNumber(key: Exclude<keyof MixerMaster, 'limiter'>, value: number) {
        edit(state => state.master[key] = value);
    }

    function route(id: string, target: string) {
        if (!canRoute(mixer, id, target)) {
            return;
        }
        editChannel(id, channel => channel.output = target);
    }

    function addSend(id: string, target: string) {
        if (target === 'master' || !canRoute(mixer, id, target)) {
            return;
        }
        editChannel(id, channel => {
            if (!channel.sends.some(send => send.busId === target)) {
                channel.sends.push({busId: target, level: 0.25});
            }
        });
    }

    function selectStrip(id: string) {
        selectedId = id;
        void tick().then(() => details?.focus());
    }

    function closeDetails() {
        const heading = [...root.querySelectorAll<HTMLButtonElement>('[data-strip]')]
            .find(button => button.dataset.strip === selectedId);
        selectedId = '';
        heading?.focus();
    }

    function toggleStrip(id: string) {
        if (selectedId === id) {
            closeDetails();
        } else {
            selectStrip(id);
        }
    }

    function addBus(effect: MixerBus['effect']) {
        edit(state => {
            const bus = addMixerBus(state, effect);
            if (bus) {
                selectStrip(bus.id);
            }
        });
    }

    function deleteBus(id: string) {
        edit(state => removeMixerBus(state, id));
        selectStrip('master');
    }

    function renameBus(id: string, input: HTMLInputElement) {
        const name = input.value.trim().slice(0, 80);
        if (!name) {
            input.value = mixer.buses.find(bus => bus.id === id)?.name ?? '';
            return;
        }
        edit(state => {
            const bus = state.buses.find(bus => bus.id === id);
            if (bus) {
                bus.name = name;
            }
        });
    }

    function db(value: number): string {
        return value > 0 ? (20 * Math.log10(value)).toFixed(1) : '−∞';
    }
</script>

{#snippet numberControl(label: string, value: number, min: number, max: number, step: number, change: (value: number) => void, unit = '')}
    <label class="number-control">
        <span>{label}
            <output>{Number(value.toFixed(2))}{unit ? ` ${unit}` : ''}</output></span>
        <input
                aria-label={label}
                aria-valuetext={`${value} ${unit}`}
                {max}
                {min}
                oninput={e => numeric(e.currentTarget, min, max, change)}
                {step}
                type="range"
                {value}>
    </label>
{/snippet}

<div bind:this={root} class="mixer">
    {#if $rendering}
        <p class="render-notice" role="status">Rendering WAV — mixer editing and live meters are paused.</p>
    {/if}
    <fieldset class="mixer-editing" disabled={$rendering || !$project}>
        <legend class="sr-only">Mixer controls</legend>
        <div class="mixer-actions">
            <div class="flow-heading">
                <strong>Channels</strong>
                <span>Signal flows left to right into Master</span>
            </div>
            <div class="bus-actions">
                <button
disabled={mixer.buses.length >= MAX_MIXER_BUSES}
onclick={() => addBus('none')}
                        title="Add a routing bus"
type="button">+
                    Group bus
                </button>
                <button
disabled={mixer.buses.length >= MAX_MIXER_BUSES}
onclick={() => addBus('delay')}
                        title="Add a wet-only delay return"
type="button">+
                    Delay return
                </button>
            </div>
        </div>
        <div class="console">
            <div class="strips" aria-label="Mixer channels, horizontally scrollable" role="region">
                <section class="strip-bank" aria-labelledby="instrument-bank-heading">
                    <div id="instrument-bank-heading" class="bank-heading">Instruments</div>
                    <div class="strip-row">
                        {#each strips.filter(strip => strip.kind === 'Instrument') as strip (strip.id)}
                            <MixerStrip
                                    id={strip.id}
                                    name={strip.name}
                                    channel={strip.channel}
                                    color={strip.color}
                                    kind={strip.kind}
                                    onedit={change => editChannel(strip.id, change)}
                                    onselect={() => toggleStrip(strip.id)}
                                    outputs={mixer.buses}
                                    peak={meters.channels[strip.id]?.peak ?? 0}
                                    rms={meters.channels[strip.id]?.rms ?? 0}
                                    selected={selected?.id === strip.id}/>
                        {/each}
                    </div>
                </section>
                <section class="strip-bank bus-bank" aria-labelledby="bus-bank-heading">
                    <div id="bus-bank-heading" class="bank-heading">Buses / FX</div>
                    {#if mixer.buses.length}
                        <div class="strip-row">
                            {#each strips.filter(strip => strip.kind !== 'Instrument') as strip (strip.id)}
                                <MixerStrip
                                        id={strip.id}
                                        name={strip.name}
                                        channel={strip.channel}
                                        color={strip.color}
                                        kind={strip.kind}
                                        onedit={change => editChannel(strip.id, change)}
                                        onselect={() => toggleStrip(strip.id)}
                                        outputs={mixer.buses}
                                        peak={meters.channels[strip.id]?.peak ?? 0}
                                        rms={meters.channels[strip.id]?.rms ?? 0}
                                        selected={selected?.id === strip.id}/>
                            {/each}
                        </div>
                    {:else}
                        <p class="empty-bank">Add a bus for submixes or delay.</p>
                    {/if}
                </section>
            </div>
            <section class="master-strip" class:selected={selectedId === 'master'} aria-label="Master strip">
                <button
                        class="master-heading"
                        aria-controls="mixer-details"
                        aria-expanded={selectedId === 'master'}
                        aria-label="Master settings"
                        data-strip="master"
                        onclick={() => toggleStrip('master')}
                        type="button">
                    <span class="master-kind">Final output</span><strong>Master</strong><span aria-hidden="true">···</span>
                </button>
                <button
                        class="limiter-toggle"
                        aria-pressed={mixer.master.limiter}
                        onclick={() => edit(state => state.master.limiter = !state.master.limiter)}
                        title="Sample-peak limiter · 5ms lookahead"
                        type="button">
                    Limiter
                </button>
                <div class="reduction" title="Limiter gain reduction">
                    {Math.max(0, meters.master.reduction).toFixed(1)} dB GR
                </div>
                <MixerFader
                        name="Master"
                        max={1}
                        onchange={value => masterNumber('vol', value)}
                        peaks={meters.master.peak}
                        value={mixer.master.vol}/>
                <span class="output-label">→ Stereo out</span>
            </section>
        </div>
        {#if selected || selectedId === 'master'}
            <section
                    bind:this={details}
                    id="mixer-details"
                    class="details"
                    aria-label={selected ? `${selected.name} settings` : 'Master settings'}
                    tabindex="-1">
                <div class="details-heading">
                    <div class="inspector-title">
                        <span>Channel inspector</span>
                        {#if selectedBus}
                            <label class="bus-identity"><span class="sr-only">Bus name</span>
                                <input
                                        maxlength="80"
                                        onchange={e => renameBus(selectedBus.id, e.currentTarget)}
                                        type="text"
                                        value={selectedBus.name}>
                            </label>
                        {:else}
                            <h4>{selected?.name ?? 'Master'}</h4>
                        {/if}
                    </div>
                    <button aria-label="Close channel settings" onclick={closeDetails} type="button">×</button>
                </div>
                {#key selectedId}
                    {#if selected}
                        {@const
                            availableSends = mixer.buses.filter(bus => canRoute(mixer, selected.id, bus.id) && !selected.channel.sends.some(send => send.busId === bus.id))}
                        <div class="channel-controls">
                            <label class="output-control">Output
                                <select
                                        aria-label={`${selected.name} output`}
                                        onchange={e => route(selected.id, e.currentTarget.value)}
                                        value={selected.channel.output}>
                                    <option value="master">Master</option>
                                    {#each mixer.buses.filter(bus => canRoute(mixer, selected.id, bus.id)) as bus (bus.id)}
                                        <option value={bus.id}>{bus.name}{bus.effect === 'delay' ? ' (wet delay)' : ''}</option>
                                    {/each}
                                </select>
                            </label>
                            {@render numberControl('Reverb send', selected.channel.reverb * 100, 0, 100, 1, value => editChannel(selected.id, c => c.reverb = value / 100), '%')}
                            {#each selected.channel.sends as send (send.busId)}
                                <div class="send">
                                    {@render numberControl(`Send to ${mixer.buses.find(bus => bus.id === send.busId)?.name}`, send.level * 100, 0, 100, 1, value => editChannel(selected.id, c => {
                                        const target = c.sends.find(s => s.busId === send.busId);
                                        if (target) {
                                            target.level = value / 100;
                                        }
                                    }), '%')}
                                    <button
                                            aria-label={`Remove send to ${mixer.buses.find(bus => bus.id === send.busId)?.name}`}
                                            onclick={() => editChannel(selected.id, c => c.sends = c.sends.filter(s => s.busId !== send.busId))}
                                            type="button">×
                                    </button>
                                </div>
                            {/each}
                            {#if availableSends.length}
                                <label class="output-control">Send a copy
                                    <select
                                            aria-label="Add send"
                                            onchange={e => { addSend(selected.id, e.currentTarget.value); e.currentTarget.value = ''; }}
                                            title="Post-fader only"
                                            value="">
                                        <option value="">+ Send…</option>
                                        {#each availableSends as bus (bus.id)}
                                            <option value={bus.id}>{bus.name}</option>
                                        {/each}
                                    </select>
                                </label>
                            {/if}
                            {#if selectedBus?.effect === 'delay'}
                                {@render numberControl('Delay time', selectedBus.delayTime, 0.02, 2, 0.01, value => edit(state => {
                                    const bus = state.buses.find(b => b.id === selectedBus?.id);
                                    if (bus) {
                                        bus.delayTime = value;
                                    }
                                }), 's')}
                                {@render numberControl('Feedback', selectedBus.feedback * 100, 0, 80, 1, value => edit(state => {
                                    const bus = state.buses.find(b => b.id === selectedBus?.id);
                                    if (bus) {
                                        bus.feedback = value / 100;
                                    }
                                }), '%')}
                            {/if}
                        </div>
                        {#if selectedBus?.effect === 'delay'}
                            <p class="mixer-note">Wet-only delay return — send a copy here to add echoes.</p>
                        {/if}
                        <details class="processing">
                            <summary>Tone &amp; dynamics
                                <span>{selected.channel.highpass > 20 || selected.channel.tilt !== 0 ? 'EQ' : ''}{selected.channel.compressor.enabled ? ' · Compressor' : ''}</span>
                            </summary>
                            <div class="channel-controls">
                                {@render numberControl('High-pass', selected.channel.highpass, 20, 1000, 1, value => editChannel(selected.id, c => c.highpass = value), 'Hz')}
                                {@render numberControl('Tilt', selected.channel.tilt, -12, 12, 0.1, value => editChannel(selected.id, c => c.tilt = value), 'dB')}
                                <label class="toggle">
                                    <input
                                            checked={selected.channel.compressor.enabled}
                                            onchange={e => { const checked = e.currentTarget.checked; editChannel(selected.id, c => c.compressor.enabled = checked); }}
                                            type="checkbox">
                                    Compressor
                                </label>
                                {#if selected.channel.compressor.enabled}
                                    {@render numberControl('Threshold', selected.channel.compressor.threshold, -60, 0, 1, value => editChannel(selected.id, c => c.compressor.threshold = value), 'dB')}
                                    {@render numberControl('Ratio', selected.channel.compressor.ratio, 1, 20, 0.1, value => editChannel(selected.id, c => c.compressor.ratio = value), ':1')}
                                {/if}
                            </div>
                        </details>
                        {#if selectedBus}
                            <button
                                    class="delete-bus"
                                    onclick={() => deleteBus(selectedBus.id)}
                                    title="Dependents route to Master; sends to this bus are removed"
                                    type="button">
                                Delete bus
                            </button>
                        {/if}
                    {:else}
                        <div class="channel-controls">
                            {@render numberControl('Reverb return', mixer.master.rev * 100, 0, 100, 1, value => masterNumber('rev', value / 100), '%')}
                            {@render numberControl('Master tilt', mixer.master.tilt, -12, 12, 0.1, value => masterNumber('tilt', value), 'dB')}
                            <div class="meter-readings">
                                {#each ['L', 'R'] as side, i (side)}
                                    <span>{side} · Peak {db(meters.master.peak[i] ?? 0)}
                                        · RMS {db(meters.master.rms[i] ?? 0)} dBFS</span>
                                {/each}
                            </div>
                        </div>
                        <details class="processing">
                            <summary>Limiter settings <span>{mixer.master.limiter ? 'On' : 'Off'}</span></summary>
                            <div class="channel-controls">
                                {@render numberControl('Drive', mixer.master.driveDb, 0, 18, 0.1, value => masterNumber('driveDb', value), 'dB')}
                                {@render numberControl('Ceiling', mixer.master.ceilingDb, -12, 0, 0.1, value => masterNumber('ceilingDb', value), 'dBFS')}
                                {@render numberControl('Release', mixer.master.release, 0.02, 1, 0.01, value => masterNumber('release', value), 's')}
                            </div>
                            <p class="mixer-note">Sample-peak protection · 5ms lookahead.</p>
                        </details>
                    {/if}
                {/key}
            </section>
        {:else}
            <section id="mixer-details" class="inspector-empty" aria-label="Channel inspector">
                <strong>Channel inspector</strong>
                <span>Select a strip to edit routing, sends and processing.</span>
            </section>
        {/if}
    </fieldset>
</div>

<style>
    .mixer {
        min-width: 0;
        font-size: 12px;
    }

    .mixer-note {
        color: var(--color-text-muted);
        font-size: 11px;
        line-height: 1.5;
        margin: 10px 0;
    }

    .render-notice {
        color: var(--color-warning);
    }

    .mixer-editing {
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
    }

    .mixer-editing:disabled {
        opacity: .6;
    }

    .mixer-actions, .bus-actions, .details-heading {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .mixer-actions, .details-heading {
        justify-content: space-between;
        margin-bottom: 12px;
    }

    .flow-heading {
        display: grid;
        gap: 3px;
    }

    .flow-heading span {
        color: var(--color-text-muted);
        font-size: 10px;
    }

    .bus-actions button {
        background: transparent;
        padding: 5px 8px;
    }

    .console {
        display: flex;
        align-items: stretch;
        gap: 10px;
    }

    .strips {
        display: flex;
        align-items: stretch;
        gap: 12px;
        flex: 1;
        min-width: 0;
        overflow-x: auto;
        padding-bottom: 10px;
        scrollbar-gutter: stable;
    }

    .strip-bank {
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        gap: 6px;
        padding: 6px;
        border-radius: 4px;
        background: var(--color-surface-input);
    }

    .bus-bank {
        min-width: 112px;
        background: var(--color-surface-deep);
    }

    .strip-row {
        display: flex;
        gap: 4px;
        flex: 1;
    }

    .bank-heading {
        color: var(--color-text-muted);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
    }

    .empty-bank {
        width: 100px;
        margin: auto 0;
        color: var(--color-text-muted);
        font-size: 10px;
        line-height: 1.4;
    }

    .master-strip {
        display: flex;
        position: sticky;
        right: 0;
        z-index: 2;
        flex: 0 0 96px;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        margin-bottom: 10px;
        border: 1px solid var(--border);
        border-top: 3px solid var(--accent);
        border-radius: 3px;
        background: var(--color-surface-deep);
        box-shadow: -8px 0 12px color-mix(in srgb, var(--color-surface-deep) 70%, transparent);
    }

    .master-strip.selected {
        border-color: var(--accent);
    }

    .master-heading {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 10px;
        height: 56px;
        padding: 3px;
        background: transparent;
        border: 0;
    }

    .master-heading span {
        color: var(--color-text-muted);
    }

    .master-heading .master-kind {
        color: var(--accent);
        font-size: 9px;
        text-transform: uppercase;
    }

    .limiter-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        height: 32px;
        padding: 5px;
    }

    .limiter-toggle::before {
        content: '';
        width: 5px;
        height: 5px;
        border: 1px solid currentColor;
        border-radius: 50%;
    }

    .limiter-toggle[aria-pressed=true]::before {
        background: currentColor;
    }

    .limiter-toggle[aria-pressed=true] {
        color: var(--accent2);
        border-color: var(--accent2);
    }

    .reduction {
        font-size: 10px;
        color: var(--color-text-muted);
        text-align: center;
        height: 36px;
        line-height: 30px;
        font-variant-numeric: tabular-nums;
    }

    .output-label {
        font-size: 10px;
        color: var(--color-text-muted);
        text-align: center;
        padding: 5px 0;
    }

    .details {
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 14px;
        margin-top: 8px;
        background: var(--color-surface-deep);
    }

    .inspector-title {
        display: grid;
        gap: 4px;
        min-width: 0;
    }

    .inspector-title > span,
    .inspector-empty > strong {
        color: var(--accent);
        font-size: 9px;
        letter-spacing: .08em;
        text-transform: uppercase;
    }

    .inspector-empty {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
        padding: 12px 14px;
        border-top: 1px solid var(--border-subtle);
        color: var(--color-text-muted);
        font-size: 11px;
    }

    .details-heading h4 {
        margin: 0;
        overflow-wrap: anywhere;
        font-size: 12px;
    }

    .details-heading button {
        padding: 2px 8px;
        background: transparent;
        border: 0;
        font-size: 20px;
    }

    .bus-identity {
        min-width: 0;
    }

    .channel-controls {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        align-items: center;
        gap: 16px;
        margin: 12px 0;
    }

    .number-control, .output-control {
        display: flex;
        flex-direction: column;
        gap: 7px;
        min-width: 0;
        font-size: 11px;
    }

    .number-control span {
        display: flex;
        justify-content: space-between;
        gap: 8px;
    }

    output {
        color: var(--accent2);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    input[type=text], select {
        padding: 6px;
        min-width: 0;
        max-width: 100%;
    }

    input[type=range] {
        margin: 0;
    }

    .toggle {
        display: flex;
        align-items: center;
        gap: 7px;
    }

    .send {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .send label {
        flex: 1;
    }

    .send button {
        background: transparent;
        border: 0;
        padding: 3px 6px;
    }

    .processing {
        border-top: 1px solid var(--border-subtle);
        margin-top: 12px;
        padding-top: 12px;
    }

    summary {
        cursor: pointer;
        font-size: 11px;
    }

    summary span {
        color: var(--color-text-muted);
        margin-left: 8px;
    }

    .delete-bus {
        color: var(--color-error);
        background: transparent;
        border: 0;
        margin-top: 12px;
        padding: 4px 0;
        font-size: 10px;
    }

    .meter-readings {
        display: grid;
        gap: 5px;
        font-size: 10px;
        color: var(--color-text-muted);
        font-variant-numeric: tabular-nums;
    }

    .details:focus-visible, .strips:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

</style>
