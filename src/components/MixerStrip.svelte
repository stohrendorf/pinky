<script lang="ts">
    import type {
        MixerBus, MixerChannel
    } from '../lib/mixer';

    interface Props {
        channel: MixerChannel;
        name: string;
        kind: string;
        selected: boolean;
        outputs: MixerBus[];
        peak: number;
        rms: number;
        onselect: () => void;
        onedit: (change: (channel: MixerChannel) => void) => void;
        onroute: (target: string) => void;
    }

    // Props must keep following project edits, history and live meters.
    // eslint-disable-next-line prefer-const
    let {channel, name, kind, selected, outputs, peak, rms, onselect, onedit, onroute}: Props = $props();

    function level(value: number): string {
        return value > 0 ? (20 * Math.log10(value)).toFixed(1) : '−∞';
    }

    function changeNumber(input: HTMLInputElement, key: 'volume' | 'pan' | 'reverb') {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value)) {return;}
        const min = key === 'pan' ? -1 : 0;
        const max = key === 'volume' ? 2 : 1;
        onedit(c => c[key] = Math.max(min, Math.min(max, value)));
    }
</script>

<section class="strip" class:selected aria-label={`${name} ${kind}`}>
    <button
            class="strip-heading"
            aria-controls="mixer-details"
            aria-pressed={selected}
            onclick={onselect}
            title={`Edit ${name}: processing and sends`}
            type="button">
        <span class="kind">{kind}</span>
        <strong title={name}>{name.split('/').at(-1) || name}</strong>
        <span class="edit-hint">Processing &amp; sends</span>
    </button>
    <div class="switches">
        <button
                aria-label={`Mute ${name}`}
                aria-pressed={channel.mute}
                onclick={() => onedit(c => c.mute = !c.mute)}
                type="button">Mute</button>
        <button
                aria-label={`Solo ${name}`}
                aria-pressed={channel.solo}
                onclick={() => onedit(c => c.solo = !c.solo)}
                type="button">Solo</button>
    </div>
    <div class="channel-meter" aria-label={`${name} level`}>
        <meter aria-label={`${name} peak`} max="6" min="-60" value={peak > 0 ? 20 * Math.log10(peak) : -60}></meter>
        <span>Peak {level(peak)} dBFS</span>
        <span>RMS {level(rms)} dBFS</span>
    </div>
    <label>
        Fader <output>{level(channel.volume)} dB</output>
        <input
                aria-label={`${name} fader`}
                max="2"
                min="0"
                oninput={e => changeNumber(e.currentTarget, 'volume')}
                step="0.01"
                type="range"
                value={channel.volume}>
    </label>
    <label>
        Pan <output>{channel.pan === 0 ? 'C' : `${channel.pan < 0 ? 'L' : 'R'} ${Math.round(Math.abs(channel.pan) * 100)}`}</output>
        <input
                aria-label={`${name} pan`}
                max="1"
                min="-1"
                oninput={e => changeNumber(e.currentTarget, 'pan')}
                step="0.01"
                type="range"
                value={channel.pan}>
    </label>
    <label>
        Reverb send <output>{Math.round(channel.reverb * 100)}%</output>
        <input
                aria-label={`${name} shared reverb send`}
                max="1"
                min="0"
                oninput={e => changeNumber(e.currentTarget, 'reverb')}
                step="0.01"
                type="range"
                value={channel.reverb}>
    </label>
    <label>
        Output →
        <select aria-label={`${name} output`} onchange={e => onroute(e.currentTarget.value)} value={channel.output}>
            <option value="master">Master</option>
            {#each outputs as bus (bus.id)}
                <option value={bus.id}>{bus.name}{bus.effect === 'delay' ? ' (wet delay)' : ''}</option>
            {/each}
        </select>
    </label>
    <span class="send-count">{channel.sends.length} bus {channel.sends.length === 1 ? 'send' : 'sends'} · post-fader</span>
</section>

<style>
    .strip {
        display: flex;
        flex: 0 0 172px;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
        padding: 12px;
        border: 1px solid var(--border-subtle);
        border-radius: 3px;
        background: var(--color-surface-raised);
    }

    .strip.selected {
        border-color: var(--accent);
        box-shadow: inset 0 2px var(--accent);
    }

    .strip-heading {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 3px;
        border: 0;
        background: transparent;
        text-align: left;
        min-height: 68px;
    }

    strong {
        width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
    }

    .kind,
    .edit-hint,
    .send-count {
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .kind {
        color: var(--accent2);
        text-transform: uppercase;
    }

    .switches {
        display: flex;
        gap: 6px;
    }

    .switches button {
        flex: 1;
        padding: 6px;
    }

    .switches button[aria-pressed=true] {
        background: var(--accent);
        color: var(--action-text);
        border-color: var(--accent);
    }

    label {
        font-size: 11px;
    }

    output {
        float: right;
        color: var(--accent2);
        font-variant-numeric: tabular-nums;
    }

    input,
    select,
    meter {
        width: 100%;
        min-width: 0;
    }

    select {
        margin-top: 6px;
        padding: 5px;
    }

    .channel-meter {
        display: grid;
        gap: 3px;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        color: var(--color-text-muted);
    }
</style>