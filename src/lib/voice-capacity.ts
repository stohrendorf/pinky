export const LIVE_MAX_VOICES = 96;
export const OFFLINE_CAPACITY_MULTIPLIER = 10;
export const OFFLINE_NODE_BUDGET_MAX = 10_000;

export interface VoiceCapacity {
    nodes: number;
    voices: number;
}

/** Gives offline graphs the live allocation policy with more safe headroom. */
export function capacityForRender(nodeBudget: number, offline: boolean): VoiceCapacity {
    if (!offline) {
        return { nodes: nodeBudget, voices: LIVE_MAX_VOICES };
    }
    return {
        nodes: Math.min(OFFLINE_NODE_BUDGET_MAX, nodeBudget * OFFLINE_CAPACITY_MULTIPLIER),
        voices: LIVE_MAX_VOICES * OFFLINE_CAPACITY_MULTIPLIER,
    };
}
