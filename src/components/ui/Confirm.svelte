<script lang="ts">
    import {
        createEventDispatcher
    } from 'svelte';

    import Button from './Button.svelte';
    import Dialog from './Dialog.svelte';

    interface Props {
        show?: boolean;
        title?: string;
        message?: string;
        confirmLabel?: string;
        destructive?: boolean;
    }

    let {
        show = $bindable(false),
        title = 'Confirm',
        message = '',
        confirmLabel = 'Confirm',
        destructive = false
    }: Props = $props();

    const dispatch = createEventDispatcher<{ cancel: void; confirm: void }>();

    function confirm() {
        dispatch('confirm');
        show = false;
    }

    function cancel() {
        show = false;
        dispatch('cancel');
    }
</script>

<Dialog {show} {title} on:close={cancel}>
    <div class="confirm-body">
        <div class="confirm-message" class:destructive>
            {#if destructive}
                <i class="fa fa-triangle-exclamation" aria-hidden="true"></i>
            {/if}
            <p>{message}</p>
        </div>
        <div class="actions">
            <Button variant="secondary" on:click={cancel}>Cancel</Button>
            <Button variant={destructive ? 'danger' : 'primary'} on:click={confirm}>{confirmLabel}</Button>
        </div>
    </div>
</Dialog>

<style>
    .confirm-body {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .confirm-message {
        display: flex;
        align-items: flex-start;
        gap: 10px;
    }

    .confirm-message.destructive i {
        color: var(--color-danger);
        font-size: 16px;
        line-height: 1.2;
    }

    p {
        margin: 0;
        font-size: 14px;
        color: var(--color-text);
        line-height: 1.4;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
