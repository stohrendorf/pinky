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

    function updateValue(event: Event) {
        onchange(parseFloat((event.target as HTMLInputElement).value));
    }
</script>

<div class="slider-group">
    <label>
        {label} <span class="value">{value}{unit}</span>
        <input
                {max}
                {min}
                oninput={updateValue}
                {step}
                type="range"
                {value}>
    </label>
</div>
