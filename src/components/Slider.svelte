<script lang="ts">
    interface Props {
        label: string;
        min: number;
        max: number;
        step: number;
        unit?: string;
        value: number;
        onchange?: (v: number) => void;
    }

    const {
        label,
        min,
        max,
        step,
        unit = '',
        value,
        onchange = () => {
        }
    }: Props = $props();

    // The range input must update its label in the same event that moves its native thumb.
    // eslint-disable-next-line svelte/prefer-writable-derived
    let displayedValue = $state(value);

    $effect(() => {
        displayedValue = value;
    });

    function updateValue(event: Event) {
        displayedValue = parseFloat((event.target as HTMLInputElement).value);
        onchange(displayedValue);
    }
</script>

<div class="slider-group">
    <label>
        {label} <span class="value">{displayedValue}{unit}</span>
        <input
{max}
{min}
oninput={updateValue}
{step}
               type="range"
               value={displayedValue}>
    </label>
</div>
