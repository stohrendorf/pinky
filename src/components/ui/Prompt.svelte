<script lang="ts">
    import Button from './Button.svelte';
    import Dialog from './Dialog.svelte';

    interface Props {
        show?: boolean;
        title?: string;
        value?: string;
        label?: string;
        inputType?: string;
        inputMode?:
            | 'search'
            | 'text'
            | 'none'
            | 'tel'
            | 'url'
            | 'email'
            | 'numeric'
            | 'decimal'
            | undefined;
        oncancel?: () => void;
        onsubmit?: (value: string) => void;
    }

    let {
        show = $bindable(false),
        title = '',
        value = $bindable(''),
        label = '',
        inputType = 'text',
        inputMode = undefined,
        oncancel = () => {},
        onsubmit = () => {},
    }: Props = $props();

    function submit() {
        onsubmit(value);
        show = false;
    }

    function cancel() {
        show = false;
        oncancel();
    }

    function selectOnMount(node: HTMLInputElement) {
        requestAnimationFrame(() => {
            node.focus();
            node.select();
        });
    }
</script>

<Dialog onclose={cancel} {show} {title}>
    <div class="prompt-body">
        {#if label}<label for="prompt-input">{label}</label>{/if}
        <input
            id="prompt-input"
            aria-label={label || title}
            inputmode={inputMode}
            onkeydown={e => e.key === 'Enter' && submit()}
            type={inputType}
            bind:value
            use:selectOnMount
        />
        <div class="actions">
            <Button onclick={cancel} variant="secondary">Cancel</Button>
            <Button onclick={submit}>OK</Button>
        </div>
    </div>
</Dialog>

<style>
    .prompt-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    label {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    input {
        background: var(--color-surface-input);
        border: 1px solid var(--border);
        color: var(--primary-text);
        padding: 8px;
        border-radius: 4px;
        outline: none;
        font-size: 14px;
    }

    input:focus {
        border-color: var(--accent);
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 8px;
    }
</style>
