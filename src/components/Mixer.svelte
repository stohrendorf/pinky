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
    import MixerStrip from './MixerStrip.svelte';

    // touch() publishes in-place edits; fresh values also invalidate strip props.
    const mixer = $derived(structuredClone(resolveMixer($project?.mixer, $project?.instruments.map(inst => inst.id) ?? [])));
    const strips = $derived([
        ...($project?.instruments ?? []).map(inst => ({
            id: inst.id, name: inst.name, kind: 'Instrument', channel: mixer.channels[inst.id]
        })),
        ...mixer.buses.map(bus => ({
            id: bus.id, name: bus.name, kind: bus.effect === 'delay' ? 'Wet delay return' : 'Group', channel: bus
        }))
    ]);
    let selectedId = $state('master');
    const selected = $derived(strips.find(strip => strip.id === selectedId));
    const selectedBus = $derived(mixer.buses.find(bus => bus.id === selected?.id));
    let root: HTMLDivElement;
    let details: HTMLElement;
    const silence = {master: {peak: [0, 0], rms: [0, 0], reduction: 0}, channels: {}};
    let meters = $state<ReturnType<typeof mixerMeters>>(silence);

    onMount(() => {
        const timer = setInterval(() => {
            meters = $rendering ? silence : mixerMeters();
        }, 1000 / 15);
        const dialog = root.closest<HTMLElement>('[role="dialog"]');
        const trapFocus = (event: KeyboardEvent) => {
            if (event.key !== 'Tab' || !dialog) {return;}
            const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]')]
                .filter(el => !el.matches(':disabled') && el.getClientRects().length > 0);
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
        if (!$project || $rendering) {return;}
        change(ensureMixer($project));
        touch();
    }

    function editChannel(id: string, change: (channel: MixerChannel) => void) {
        edit(state => {
            const channel = state.channels[id] ?? state.buses.find(bus => bus.id === id);
            if (channel) {change(channel);}
        });
    }

    function numeric(input: HTMLInputElement, min: number, max: number, change: (value: number) => void) {
        const value = input.valueAsNumber;
        if (Number.isFinite(value)) {change(Math.max(min, Math.min(max, value)));}
    }

    function masterNumber(key: Exclude<keyof MixerMaster, 'limiter'>, value: number) {
        edit(state => state.master[key] = value);
    }

    function route(id: string, target: string) {
        if (!canRoute(mixer, id, target)) {return;}
        editChannel(id, channel => channel.output = target);
    }

    function addSend(id: string, target: string) {
        if (target === 'master' || !canRoute(mixer, id, target)) {return;}
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

    function addBus(effect: MixerBus['effect']) {
        edit(state => {
            const bus = addMixerBus(state, effect);
            if (bus) {selectStrip(bus.id);}
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
            if (bus) {bus.name = name;}
        });
    }

    function db(value: number): string {
        return value > 0 ? (20 * Math.log10(value)).toFixed(1) : '−∞';
    }
</script>

{#snippet numberControl(label: string, value: number, min: number, max: number, step: number, change: (value: number) => void, unit = '')}
    <label class="number-control">
        <span>{label} {unit ? `(${unit})` : ''}</span>
        <input
                {max}
                {min}
                oninput={e => numeric(e.currentTarget, min, max, change)}
                {step}
                type="number"
                {value}>
    </label>
{/snippet}

<div bind:this={root} class="mixer">
    <p class="mixer-note">Solo-in-place preserves contributing sources and their sends. A muted strip cuts new input; effect tails decay.</p>
    {#if $rendering}
        <p class="render-notice" role="status">Rendering WAV — mixer editing and live meters are paused.</p>
    {/if}
    <fieldset class="mixer-editing" disabled={$rendering || !$project}>
        <legend class="sr-only">Mixer controls</legend>
        <div class="mixer-actions">
            <div class="bus-actions">
                <button disabled={mixer.buses.length >= MAX_MIXER_BUSES} onclick={() => addBus('none')} type="button">+ Group</button>
                <button disabled={mixer.buses.length >= MAX_MIXER_BUSES} onclick={() => addBus('delay')} type="button">+ Delay return</button>
                <span>{mixer.buses.length}/{MAX_MIXER_BUSES} buses</span>
            </div>
            <button onclick={() => selectStrip('master')} type="button">Master protection</button>
        </div>
        <div class="strips" aria-label="Mixer channel strips" role="region">
            {#each strips as strip (strip.id)}
                <MixerStrip
                        name={strip.name}
                        channel={strip.channel}
                        kind={strip.kind}
                        onedit={change => editChannel(strip.id, change)}
                        onroute={target => route(strip.id, target)}
                        onselect={() => selectStrip(strip.id)}
                        outputs={mixer.buses.filter(bus => canRoute(mixer, strip.id, bus.id))}
                        peak={meters.channels[strip.id]?.peak ?? 0}
                        rms={meters.channels[strip.id]?.rms ?? 0}
                        selected={selected?.id === strip.id}/>
            {/each}
            <section class="master-strip" aria-label="Master strip">
                <button
                        class="master-heading"
                        aria-controls="mixer-details"
                        aria-pressed={!selected}
                        onclick={() => selectStrip('master')}
                        type="button">Master <span>Output &amp; protection</span></button>
                <div class="master-meters" aria-label="Stereo master levels">
                    {#each ['L', 'R'] as side, i (side)}
                        <div class:overload={(meters.master.peak[i] ?? 0) > 1}>
                            <strong>{side}</strong>
                            <meter
                                    aria-label={`Master ${side} peak`}
                                    max="6"
                                    min="-60"
                                    value={meters.master.peak[i] > 0 ? 20 * Math.log10(meters.master.peak[i]) : -60}></meter>
                            <span>Peak {db(meters.master.peak[i] ?? 0)} dBFS</span>
                            <span>RMS {db(meters.master.rms[i] ?? 0)} dBFS</span>
                        </div>
                    {/each}
                    <span>Limiter GR: {Math.max(0, meters.master.reduction).toFixed(1)} dB</span>
                </div>
                {@render numberControl('Master volume', mixer.master.vol, 0, 1, 0.01, value => masterNumber('vol', value))}
                {@render numberControl('Reverb return', mixer.master.rev, 0, 1, 0.01, value => masterNumber('rev', value))}
                {@render numberControl('Master tilt', mixer.master.tilt, -12, 12, 0.1, value => masterNumber('tilt', value), 'dB')}
                <span class="protection-state">Sample-peak limiter {mixer.master.limiter ? 'ON' : 'OFF'}</span>
            </section>
        </div>
        <section
                bind:this={details}
                id="mixer-details"
                class="details"
                aria-label={selected ? `${selected.name} processing and sends` : 'Master protection'}
                tabindex="-1">
            {#if selected}
                <h4>{selected.name} <span>{selected.kind} · output → {mixer.buses.find(bus => bus.id === selected.channel.output)?.name ?? 'Master'}</span></h4>
                {#if selectedBus}
                    <div class="bus-identity">
                        <label>
                            Bus name
                            <input
                                    maxlength="80"
                                    onchange={e => renameBus(selectedBus.id, e.currentTarget)}
                                    type="text"
                                    value={selectedBus.name}>
                        </label>
                        <button
                                class="delete-bus"
                                onclick={() => deleteBus(selectedBus.id)}
                                title="Dependents route to Master; sends to this bus are removed"
                                type="button">Delete bus</button>
                        <span>Deleting routes dependents to Master and removes sends to this bus.</span>
                    </div>
                {/if}
                <div class="processing">
                    {@render numberControl('High-pass', selected.channel.highpass, 20, 1000, 1, value => editChannel(selected.id, c => c.highpass = value), 'Hz')}
                    {@render numberControl('Tilt', selected.channel.tilt, -12, 12, 0.1, value => editChannel(selected.id, c => c.tilt = value), 'dB')}
                    <label class="toggle">
                        <input
                                checked={selected.channel.compressor.enabled}
                                onchange={e => { const checked = e.currentTarget.checked; editChannel(selected.id, c => c.compressor.enabled = checked); }}
                                type="checkbox">
                        Compressor
                    </label>
                    {@render numberControl('Threshold', selected.channel.compressor.threshold, -60, 0, 1, value => editChannel(selected.id, c => c.compressor.threshold = value), 'dB')}
                    {@render numberControl('Ratio', selected.channel.compressor.ratio, 1, 20, 0.1, value => editChannel(selected.id, c => c.compressor.ratio = value), ':1')}
                    {#if selectedBus?.effect === 'delay'}
                        {@render numberControl('Delay time', selectedBus.delayTime, 0.02, 2, 0.01, value => edit(state => { const bus = state.buses.find(b => b.id === selectedBus?.id); if (bus) {bus.delayTime = value;} }), 's')}
                        {@render numberControl('Feedback', selectedBus.feedback, 0, 0.8, 0.01, value => edit(state => { const bus = state.buses.find(b => b.id === selectedBus?.id); if (bus) {bus.feedback = value;} }))}
                    {/if}
                </div>
                {#if selectedBus?.effect === 'delay'}
                    <p class="mixer-note">Wet-only delay return. Send a source here to add echoes; routing its output here replaces its dry path.</p>
                {/if}
                <div class="sends-heading">
                    <h4>Bus sends <span>Post-fader only</span></h4>
                    <label>
                        Add send
                        <select
                                onchange={e => { addSend(selected.id, e.currentTarget.value); e.currentTarget.value = ''; }}
                                value="">
                            <option value="">Choose a bus…</option>
                            {#each mixer.buses.filter(bus => canRoute(mixer, selected.id, bus.id) && !selected.channel.sends.some(send => send.busId === bus.id)) as bus (bus.id)}
                                <option value={bus.id}>{bus.name}{bus.effect === 'delay' ? ' (wet delay)' : ''}</option>
                            {/each}
                        </select>
                    </label>
                </div>
                <div class="sends">
                    {#each selected.channel.sends as send (send.busId)}
                        <div class="send">
                            <label>
                                → {mixer.buses.find(bus => bus.id === send.busId)?.name} <output>{Math.round(send.level * 100)}%</output>
                                <input
                                        aria-label={`Send to ${mixer.buses.find(bus => bus.id === send.busId)?.name}`}
                                        max="1"
                                        min="0"
                                        oninput={e => numeric(e.currentTarget, 0, 1, value => editChannel(selected.id, c => { const target = c.sends.find(s => s.busId === send.busId); if (target) {target.level = value;} }))}
                                        step="0.01"
                                        type="range"
                                        value={send.level}>
                            </label>
                            <button
                                    aria-label={`Remove send to ${mixer.buses.find(bus => bus.id === send.busId)?.name}`}
                                    onclick={() => editChannel(selected.id, c => c.sends = c.sends.filter(s => s.busId !== send.busId))}
                                    type="button">Remove</button>
                        </div>
                    {:else}
                        <p class="mixer-note">No bus sends. Add a group or delay return above, then choose it here.</p>
                    {/each}
                </div>
                <p class="mixer-note">Routing choices exclude feedback loops, even through muted strips or sends at zero.</p>
            {:else}
                <h4>Master protection</h4>
                <div class="processing">
                    <label class="toggle">
                        <input
                                checked={mixer.master.limiter}
                                onchange={e => { const checked = e.currentTarget.checked; edit(state => state.master.limiter = checked); }}
                                type="checkbox">
                        Sample-peak limiter
                    </label>
                    {@render numberControl('Drive', mixer.master.driveDb, 0, 18, 0.1, value => masterNumber('driveDb', value), 'dB')}
                    {@render numberControl('Ceiling', mixer.master.ceilingDb, -12, 0, 0.1, value => masterNumber('ceilingDb', value), 'dBFS')}
                    {@render numberControl('Release', mixer.master.release, 0.02, 1, 0.01, value => masterNumber('release', value), 's')}
                </div>
                <p class="mixer-note">Sample-peak protection · 5ms lookahead. Meters show sample peak and RMS in dBFS, plus limiter gain reduction (GR) in dB.</p>
                <p class="mixer-note">Reverb return controls the shared wet return; each strip has an independent reverb send. Mixer fader and pan do not change the instrument patch.</p>
            {/if}
        </section>
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
        margin: 0 0 12px;
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

    .mixer-actions,
    .bus-actions,
    .sends-heading,
    .bus-identity {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
    }

    .mixer-actions,
    .sends-heading {
        justify-content: space-between;
    }

    .bus-actions {
        margin: 0;
    }

    .strips {
        display: flex;
        align-items: stretch;
        gap: 10px;
        overflow-x: auto;
        scroll-padding-inline-end: 250px;
        padding: 3px 3px 14px;
    }

    .master-strip {
        position: sticky;
        right: 0;
        z-index: 1;
        display: flex;
        flex: 0 0 220px;
        flex-direction: column;
        gap: 12px;
        border: 1px solid var(--accent2);
        border-radius: 3px;
        padding: 12px;
        background: var(--color-surface-deep);
        box-shadow: -6px 0 12px rgb(0 0 0 / .25);
    }

    .master-heading {
        text-align: left;
        font-size: 13px;
    }

    .master-heading[aria-pressed=true] {
        border-color: var(--accent);
    }

    .master-heading span,
    .protection-state {
        display: block;
        font-size: 10px;
        color: var(--accent2);
        margin-top: 5px;
    }

    .master-meters {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
    }

    .master-meters > div {
        display: grid;
        gap: 3px;
    }

    .master-meters > span {
        grid-column: 1 / -1;
        color: var(--color-warning);
    }

    .master-meters meter {
        width: 100%;
    }

    .overload,
    .delete-bus {
        color: var(--color-error);
    }

    .details {
        border: 1px solid var(--border);
        padding: 14px;
        margin-top: 6px;
        background: var(--color-surface-deep);
    }

    .details:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    h4 {
        margin: 0 0 12px;
        overflow-wrap: anywhere;
    }

    h4 span,
    .bus-identity > span,
    .bus-actions > span {
        color: var(--color-text-muted);
        font-size: 10px;
        font-weight: 400;
    }

    .processing,
    .sends {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
        gap: 12px;
        margin-bottom: 12px;
    }

    .number-control {
        display: flex;
        flex-direction: column;
        gap: 5px;
        font-size: 11px;
    }

    input[type=number],
    input[type=text],
    select {
        padding: 6px;
        min-width: 0;
        max-width: 100%;
    }

    .toggle {
        display: flex;
        align-items: center;
        gap: 7px;
    }

    .send {
        border: 1px solid var(--border-subtle);
        padding: 8px;
        min-width: 0;
    }

    .send label {
        overflow-wrap: anywhere;
    }

    .send output {
        color: var(--accent2);
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