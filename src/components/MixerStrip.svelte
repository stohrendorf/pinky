<script lang="ts">
    import type { MixerBus, MixerChannel } from '../lib/mixer';

    import MixerFader from './MixerFader.svelte';

    interface Props {
        channel: MixerChannel;
        id: string;
        color: string;
        name: string;
        kind: string;
        selected: boolean;
        outputs: MixerBus[];
        peak: number;
        rms: number;
        onselect: () => void;
        onedit: (change: (channel: MixerChannel) => void) => void;
    }

    // Props must keep following project edits, history and live meters.
    // eslint-disable-next-line prefer-const
    let { channel, name, kind, selected, outputs, peak, rms, onselect, onedit, id, color }: Props =
        $props();

    function level(value: number): string {
        return value > 0 ? (20 * Math.log10(value)).toFixed(1) : '−∞';
    }

    function changeNumber(input: HTMLInputElement, key: 'volume' | 'pan' | 'reverb') {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value)) {
            return;
        }
        const min = key === 'pan' ? -1 : 0;
        const max = key === 'volume' ? 2 : 1;
        onedit(c => (c[key] = Math.max(min, Math.min(max, value))));
    }
</script>

<section
    style:--strip-color={color}
    class="strip"
    class:bus={kind !== 'Instrument'}
    class:delay-return={kind === 'Delay return'}
    class:muted={channel.mute}
    class:selected
    aria-label={`${name} ${kind}`}
>
    <button
        class="strip-heading"
        aria-controls="mixer-details"
        aria-expanded={selected}
        aria-label={`${name} settings`}
        data-strip={id}
        onclick={onselect}
        title={name}
        type="button"
    >
        <span class="kind">{kind}</span>
        <strong title={name}>{name}</strong>
    </button>
    <label class="pan">
        <span
            >Pan <output
                >{channel.pan === 0
                    ? 'C'
                    : `${channel.pan < 0 ? 'L' : 'R'} ${Math.round(Math.abs(channel.pan) * 100)}`}</output
            ></span
        >
        <input
            aria-label={`${name} pan`}
            aria-valuetext={channel.pan === 0
                ? 'Center'
                : `${Math.round(Math.abs(channel.pan) * 100)}% ${channel.pan < 0 ? 'left' : 'right'}`}
            max="1"
            min="-1"
            oninput={e => changeNumber(e.currentTarget, 'pan')}
            step="0.01"
            type="range"
            value={channel.pan}
        />
    </label>
    <div class="switches">
        <button
            class="channel-toggle"
            class:active={channel.mute}
            aria-label={`Mute ${name}`}
            aria-pressed={channel.mute}
            onclick={() => onedit(c => (c.mute = !c.mute))}
            title="Mute — effect tails decay"
            type="button"
            ><i class="fa fa-volume-xmark" aria-hidden="true"></i>
        </button>
        <button
            class="channel-toggle"
            class:active={channel.solo}
            aria-label={`Solo ${name}`}
            aria-pressed={channel.solo}
            onclick={() => onedit(c => (c.solo = !c.solo))}
            title="Solo — includes contributing sources and sends"
            type="button"
            ><i class="fa fa-headphones" aria-hidden="true"></i>
        </button>
    </div>
    <div class="channel-level" title={`Peak ${level(peak)} dBFS · RMS ${level(rms)} dBFS`}>
        <MixerFader
            {name}
            onchange={value => onedit(c => (c.volume = value))}
            peaks={[peak]}
            value={channel.volume}
        />
    </div>
    <button
        class="route"
        aria-label={`${name} routing and effects`}
        onclick={onselect}
        title={`Output: ${outputs.find(bus => bus.id === channel.output)?.name ?? 'Master'}`}
        type="button"
    >
        Out → {outputs.find(bus => bus.id === channel.output)?.name ?? 'Master'}
    </button>
    <span class="strip-summary">Reverb {Math.round(channel.reverb * 100)}%</span>
</section>

<style>
    .strip {
        display: flex;
        flex: 0 0 128px;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        padding: 8px;
        border: 1px solid var(--border-subtle);
        border-radius: 3px;
        background: var(--color-surface-raised);
        border-top: 3px solid var(--strip-color);
    }

    .strip.selected {
        border-color: var(--accent);
        background: var(--color-surface-hover);
        box-shadow: inset 0 0 0 1px var(--accent);
    }

    .strip.bus {
        background: var(--color-surface-deep);
        border-top-color: var(--accent2);
    }

    .strip.bus.selected {
        border-color: var(--accent);
        background: var(--color-surface-hover);
    }

    .strip.delay-return {
        border-top-style: dashed;
    }

    .strip-heading {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 3px;
        border: 0;
        background: transparent;
        text-align: left;
        min-height: 52px;
        color: var(--primary-text);
    }

    strong {
        width: 100%;
        overflow-wrap: anywhere;
        font-size: 12px;
        line-height: 1.3;
    }

    .kind {
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .kind {
        color: var(--strip-color);
        text-transform: uppercase;
        min-height: 12px;
        font-size: 9px;
    }

    .switches {
        display: flex;
        justify-content: center;
        gap: 4px;
    }

    .channel-toggle {
        width: 30px;
        height: 28px;
        padding: 4px;
        border-color: transparent;
        background: transparent;
        color: var(--color-text-muted);
    }

    .channel-toggle:hover {
        color: var(--primary-text);
        background: var(--color-surface-hover);
    }

    .channel-toggle.active,
    .channel-toggle[aria-pressed='true'] {
        background: var(--accent);
        color: var(--action-text);
        border-color: var(--accent);
    }

    .pan {
        font-size: 10px;
        color: var(--color-text-muted);
        display: grid;
        gap: 3px;
    }

    output {
        float: right;
        color: var(--accent2);
        font-variant-numeric: tabular-nums;
    }

    input {
        width: 100%;
        min-width: 0;
    }

    .route {
        text-align: left;
        overflow-wrap: anywhere;
        background: transparent;
        border: 0;
        padding: 5px 0;
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .strip-summary {
        color: var(--color-text-subtle);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
    }

    .muted .channel-level {
        opacity: 0.45;
    }

    button:focus-visible,
    input:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
</style>
