<script lang="ts">
    import type { NumericParam } from '../lib/instruments';
    import type { Instrument, InstrumentParams } from '../lib/types';

    import { CURVE_SHAPES } from '../lib/automation';
    import { ensurePartials, INSTRUMENT_PANELS } from '../lib/instruments';
    import { lastPlayedPitch, project, selInstId, touch } from '../lib/project';
    import FilterPreview from './FilterPreview.svelte';
    import HarmonicsEditor from './HarmonicsEditor.svelte';
    import Slider from './Slider.svelte';
    import Button from './ui/Button.svelte';
    import Confirm from './ui/Confirm.svelte';
    import Dialog from './ui/Dialog.svelte';
    import HierarchicalSelect from './ui/HierarchicalSelect.svelte';
    import IconButton from './ui/IconButton.svelte';
    import Prompt from './ui/Prompt.svelte';

    const STARTER_PANEL_TITLES = ['EQ Voice', 'Envelope', 'Mix'];
    const ADVANCED_PANEL_TITLES = ['Percussion', 'Formants', 'Vibrato', 'Unison', 'Legato'];
    const EDITOR_TABS = [
        { id: 'voice', label: 'Sound' },
        { id: 'advanced', label: 'Motion' },
        { id: 'harmonics', label: 'Harmonics' },
    ];
    const CONTROL_HELP: Record<
        string,
        { title: string; text: string; deepTitle: string; deep: string[] }
    > = {
        'EQ Voice': {
            title: 'Tone and resonance',
            text: 'Tone Level controls the pitched, harmonic part of the sound. Resonance focuses those harmonics more tightly: lower values are broader and gentler, while higher values make the sound more focused and pronounced.',
            deepTitle: 'Go deeper: filtering the raw sound',
            deep: [
                'Your harmonics create a raw spectrum; the filter decides which parts of it are most audible. Lower Tone Level leaves fewer upper frequencies, so a sound feels darker or farther away. Raising it exposes more high partials and makes the sound feel brighter or closer.',
                'Resonance boosts the frequencies around the filter’s focus. A small amount adds character; a high amount creates a whistle-like peak that can become part of the pitch. Try changing Tone Level first, then add resonance only when you want the filter itself to be clearly heard.',
            ],
        },
        Envelope: {
            title: 'Envelope',
            text: 'Attack is how quickly a note arrives, Decay is how quickly it falls to Sustain, and Release is how long it rings after you let go. Short attack and decay suit percussion; longer attack and release make pads and strings bloom.',
            deepTitle: 'Go deeper: why the same sound can feel like a different instrument',
            deep: [
                'The first few milliseconds tell the ear a great deal about an instrument. A fast, bright beginning suggests a pluck, hammer, or strike; a gradual beginning suggests a bowed, blown, or swelling sound. The envelope can therefore change a familiar harmonic spectrum into something that feels entirely different.',
                'Sustain is the level held while a key remains down, rather than a duration. A piano-like sound falls toward little or no sustain; an organ holds steady. Release belongs to the sound after the key is released, so longer releases create space but can cloud fast passages.',
            ],
        },
        Mix: {
            title: 'Level and pan',
            text: 'Level places this instrument in the mix. Pan places it between the left and right speakers. Set the sound first, then use these controls to make room for the other instruments.',
            deepTitle: 'Go deeper: making room instead of making everything louder',
            deep: [
                'A mix is a balance of frequency, time, and stereo position. If two parts compete, lowering one slightly is often more effective than raising the other. Parts with different octaves, envelopes, or harmonic brightness can coexist even when they play at the same time.',
                'Pan is most useful for supporting parts: keep the musical anchor—often kick, bass, and lead—near the center, then place percussion, chords, and answers around it. Extreme panning is an effect; modest offsets usually create width without making the arrangement feel lopsided.',
            ],
        },
        Percussion: {
            title: 'Percussion and impact',
            text: 'Percussion adds a wide noise band alongside the pitched sound. It creates the air of hats, the snap of snares, and the strike of kicks or bells. Noise Frequency chooses its brightness; Pitch Drop sweeps the pitch at a note’s start for kick, tom, and riser motion.',
            deepTitle: 'Go deeper: noise, impact, and pitch motion',
            deep: [
                'Noise contains many frequencies at once, unlike a pitched oscillator. A very short bright burst suggests the stick or beater hitting an object; a longer, darker burst can suggest a snare body, wind, or mechanical texture. Noise Frequency changes which area of that broad energy stands out.',
                'Pitch Drop is a fast fall in pitch after the note begins. On a kick it imitates a stretched drumhead settling after impact; on a tom it makes the hit feel larger; reversing the musical idea with a rising pitch can make a riser. Keep the time short for drums and longer for obvious effects.',
            ],
        },
        Formants: {
            title: 'Formants',
            text: 'Formants are the fixed resonances made by a voice’s throat and mouth. They stay at fixed frequencies while the note changes, which creates vowel-like color. Formant Level blends them in; F1, F2, and F3 set the resonances; Formant Q makes them broad and gentle or narrow and obvious.',
            deepTitle: 'Go deeper: how a filter can suggest a voice',
            deep: [
                'Vocal cords make a complex buzzing source, while the throat and mouth amplify selected fixed frequency regions. Those regions are formants. As you change a vowel, you mostly reshape the resonant spaces rather than changing the vocal-cord pitch.',
                'Because Pinky’s formants stay fixed while notes move, different notes pass through the same resonant bands—much like a human voice. Move F1 and F2 to explore vowel changes; use F3 more gently for presence. Narrow Q makes the effect more synthetic and explicit, while wider Q blends it into the instrument.',
            ],
        },
        Vibrato: {
            title: 'Vibrato',
            text: 'Vibrato is a repeating pitch movement. Depth controls how far it bends, Rate controls how fast it moves, and Delay lets a held note begin straight before the vibrato fades in. It is especially effective on leads, strings, and vocal-like sounds.',
            deepTitle: 'Go deeper: movement needs a reason',
            deep: [
                'Players naturally vary pitch as they sustain a note, but usually not at the exact instant it begins. Delay lets the note establish its pitch before the movement arrives, which reads as expressive rather than mechanical.',
                'Depth and rate work together: gentle, slower movement suggests a singer or string player; faster or wider movement becomes a deliberate synth effect. Use vibrato on longer notes where the ear has time to notice it, and keep fast rhythmic parts steadier.',
            ],
        },
        Unison: {
            title: 'Unison',
            text: 'Unison stacks several slightly detuned copies of the same note. More voices and a wider detune create width and chorus-like movement, but can blur the pitch and use more mix space. Keep it subtle for a natural sound.',
            deepTitle: 'Go deeper: why detuning creates width',
            deep: [
                'Nearly identical pitches drift in and out of alignment, creating slow beating that our ears interpret as movement and thickness. Spreading those copies also keeps them from occupying exactly the same place, which makes the sound feel wider.',
                'This effect is strongest on sustained chords, pads, and leads. It is less useful on bass, tight percussion, and already-busy arrangements because the same detuning can soften the pitch center and consume space needed by other parts. Start with few voices and a small spread.',
            ],
        },
        Legato: {
            title: 'Legato curves',
            text: 'Link two notes in the piano roll to glide from the source note’s end to the target note’s start. The empty gap sets the glide time, and the curve sets its shape. This default curve is used for new links; each existing link can be changed individually.',
            deepTitle: 'Go deeper: shaping a slide in time',
            deep: [
                'The source note’s end and target note’s start define the whole slide, so widening the empty gap slows it down. This makes slide timing visible and musical: you compose the gesture directly in the piano roll instead of choosing an unrelated duration.',
                'Linear moves evenly. Ease-in stays near the source pitch before accelerating; ease-out arrives early and settles; smooth eases at both ends; hold waits until the final jump. Use a curve when its motion supports the phrase, rather than adding slides to every connection.',
            ],
        },
        Harmonics: {
            title: 'Harmonics',
            text: 'Harmonics are the quieter frequencies above a note’s fundamental. Their ratios and levels are the raw fingerprint of a sound: whole-number ratios make familiar pitched timbres, organ drawbars emphasize selected octaves and fifths, and inharmonic ratios create bells and metal.',
            deepTitle: 'Go deeper: why instruments sound different',
            deep: [
                'Every pitched instrument starts with a fundamental: the frequency we hear as the note. It also produces partials above it. When their ratios are whole numbers, they repeat in a regular pattern and reinforce the same musical pitch. The ear uses the balance of those partials—its spectrum—to recognize the instrument even when two instruments play the same note.',
                'A flute-like sound has few, gentle upper partials, so it feels smooth. A clarinet-like sound emphasizes odd partials, which gives it a hollow character. A bowed string or brass sound has many strong upper partials, giving it brightness and bite. An organ does not need a vibrating string or tube: its drawbars deliberately mix octave and fifth partials, recreating the spectral ingredients of several pipe ranks.',
                'In Pinky, ratios choose where those ingredients sit and levels choose how much of each you hear. Start with a 1:1 fundamental, then add one partial at a time while holding the same note. Listen for the point where the sound gains identity rather than simply becoming brighter. Non-whole ratios no longer reinforce one clear pitch in the same way; that tension is what gives bells, metal, and struck objects their shimmer.',
            ],
        },
    };

    let showRename = $state(false);
    let renameValue = $state('');
    let showConfirmDelete = $state(false);
    let contextualHelp: keyof typeof CONTROL_HELP | null = $state(null);
    let activeTab = $state('voice');

    const starterPanels = $derived(
        INSTRUMENT_PANELS.filter(panel => STARTER_PANEL_TITLES.includes(panel.title)),
    );
    const advancedPanels = $derived(
        INSTRUMENT_PANELS.filter(panel => ADVANCED_PANEL_TITLES.includes(panel.title)),
    );

    const inst = $derived(
        ($project?.instruments.find(i => i.id === $selInstId) ||
            $project?.instruments[0]) as Instrument,
    );

    const clone = (p: InstrumentParams): InstrumentParams => JSON.parse(JSON.stringify(p));

    /* ---- A/B compare: park a snapshot in slot B and flip between the two ---- */
    let slotB: Record<string, InstrumentParams> = $state({});
    let side: Record<string, 'A' | 'B'> = $state({});

    function copyToB() {
        slotB[inst.id] = clone(inst.params);
        side[inst.id] = 'A';
        slotB = slotB;
        side = side;
    }

    function swapAB() {
        const b = slotB[inst.id];
        if (!b) {
            return;
        }
        slotB[inst.id] = clone(inst.params);
        inst.params = ensurePartials(clone(b));
        side[inst.id] = side[inst.id] === 'B' ? 'A' : 'B';
        slotB = slotB;
        side = side;
        touch();
    }

    function setParam(id: NumericParam, v: number) {
        const instrumentId = inst.id;
        project.update(current =>
            current
                ? {
                      ...current,
                      instruments: current.instruments.map(instrument =>
                          instrument.id === instrumentId
                              ? {
                                    ...instrument,
                                    params: { ...instrument.params, [id]: v },
                                }
                              : instrument,
                      ),
                  }
                : current,
        );
    }

    function setLegatoCurve(curve: string) {
        if (CURVE_SHAPES.some(shape => shape.id === curve)) {
            inst.params.legatoCurve = curve as InstrumentParams['legatoCurve'];
            touch();
        }
    }

    function toggleMute(i: Instrument) {
        i.mute = !i.mute;
        touch();
    }

    function toggleSolo(i: Instrument) {
        i.solo = !i.solo;
        touch();
    }

    function openRename() {
        renameValue = inst.name;
        showRename = true;
    }

    function onRename(value: string) {
        if (value) {
            inst.name = value;
            touch();
        }
    }

    function remove() {
        if (!$project || $project.instruments.length <= 1) {
            return;
        }
        showConfirmDelete = true;
    }

    function openControlHelp(topic: keyof typeof CONTROL_HELP) {
        contextualHelp = topic;
    }

    function onConfirmDelete() {
        if (!$project) {
            return;
        }
        const id = inst.id;
        $project.patterns.forEach(pt => delete pt.tracks[id]);
        $project.instruments = $project.instruments.filter(i => i.id !== id);
        selInstId.set($project.instruments[0].id);
    }
</script>

<div class="panel inst-panel">
    <div class="instrument-toolbar" aria-label="Selected instrument controls">
        <div class="instrument-picker">
            <HierarchicalSelect
                ariaLabel="Select instrument"
                items={$project?.instruments ?? []}
                minimal
                onselect={id => selInstId.set(id)}
                selectedId={inst?.id}
            />
        </div>
        <div class="selected-instrument-actions" aria-label="Selected instrument playback controls">
            <Button
                compact
                onclick={() => toggleMute(inst)}
                pressed={inst.mute}
                title="Mute"
                variant={inst.mute ? 'danger' : 'secondary'}
                ><i class="fa fa-volume-xmark"></i></Button
            >
            <Button
                compact
                onclick={() => toggleSolo(inst)}
                pressed={inst.solo}
                title="Solo"
                variant={inst.solo ? 'primary' : 'secondary'}
                ><i class="fa fa-headphones"></i></Button
            >
        </div>
        <div class="instrument-actions" aria-label="Selected instrument identity controls">
            <IconButton
                ariaLabel="Rename Instrument"
                icon="fa-pencil"
                onclick={openRename}
                title="Rename Instrument"
            />
            <IconButton
                ariaLabel="Delete Instrument"
                disabled={($project?.instruments.length ?? 0) <= 1}
                icon="fa-trash"
                onclick={remove}
                title="Delete Instrument"
            />
        </div>
    </div>
    <div class="audition-actions">
        <Button onclick={copyToB} title="Park the current settings in slot B" variant="secondary"
            ><i class="fa fa-copy"></i> Copy → B
        </Button>
        <Button
            disabled={!slotB[inst.id]}
            onclick={swapAB}
            title="Swap the current settings with slot B"
            variant="secondary"
            ><i class="fa fa-right-left"></i> A/B
        </Button>
        {#if slotB[inst.id]}
            <span class="ab-side">showing {side[inst.id] || 'A'}</span>
        {/if}
    </div>

    <div class="editor-tabbar">
        <div class="editor-tabs" aria-label="Instrument settings" role="tablist">
            {#each EDITOR_TABS as tab (tab.id)}
                <button
                    class:sel={activeTab === tab.id}
                    aria-selected={activeTab === tab.id}
                    onclick={() => (activeTab = tab.id)}
                    role="tab">{tab.label}</button
                >
            {/each}
        </div>
    </div>

    <div class="tab-content">
        <div class="tab-controls">
            {#if activeTab === 'voice'}
                <div class="inst-sliders starter-controls">
                    {#each starterPanels as panel (panel.title)}
                        <div class="group">
                            <div class="group-heading">
                                <h4>{panel.title}</h4>
                                <button
                                    class="control-help"
                                    aria-label={`Learn about ${panel.title}`}
                                    onclick={() =>
                                        openControlHelp(panel.title as keyof typeof CONTROL_HELP)}
                                    title={`Learn about ${panel.title}`}
                                    ><i class="fa fa-circle-question"></i>
                                </button>
                            </div>
                            {#each panel.sliders as s (s.id)}
                                <Slider
                                    {...s}
                                    onchange={v => setParam(s.id, v)}
                                    value={inst.params[s.id]}
                                />
                            {/each}
                        </div>
                    {/each}
                </div>
            {:else if activeTab === 'advanced'}
                <div class="tab-intro">Adjust attack, color, pitch movement and width.</div>
                <div class="inst-sliders advanced-grid">
                    {#each advancedPanels as panel (panel.title)}
                        <div class="group">
                            <div class="group-heading">
                                <h4>{panel.title}</h4>
                                <button
                                    class="control-help"
                                    aria-label={`Learn about ${panel.title}`}
                                    onclick={() =>
                                        openControlHelp(panel.title as keyof typeof CONTROL_HELP)}
                                    title={`Learn about ${panel.title}`}
                                    ><i class="fa fa-circle-question"></i>
                                </button>
                            </div>
                            {#each panel.sliders as s (s.id)}
                                <Slider
                                    {...s}
                                    onchange={v => setParam(s.id, v)}
                                    value={inst.params[s.id]}
                                />
                            {/each}
                            {#if panel.title === 'Legato'}
                                <label class="legato-default"
                                    >Default curve
                                    <select
                                        aria-label="Default legato curve"
                                        onchange={event =>
                                            setLegatoCurve(event.currentTarget.value)}
                                        value={inst.params.legatoCurve}
                                    >
                                        {#each CURVE_SHAPES as shape (shape.id)}
                                            <option value={shape.id}>{shape.label}</option>
                                        {/each}
                                    </select>
                                </label>
                            {/if}
                        </div>
                    {/each}
                </div>
            {:else if activeTab === 'harmonics'}
                <div class="tab-intro">
                    Draw the partials that define this instrument.
                    <button
                        class="control-help"
                        aria-label="Learn about Harmonics"
                        onclick={() => openControlHelp('Harmonics')}
                        title="Learn about Harmonics"><i class="fa fa-circle-question"></i></button
                    >
                </div>
                <HarmonicsEditor onchange={touch} params={inst.params} />
            {/if}
        </div>
        <aside class="sound-overview">
            <FilterPreview note={$lastPlayedPitch} params={inst.params} />
        </aside>
    </div>
</div>

<Prompt
    label="New Name"
    onsubmit={onRename}
    title="Rename Instrument"
    bind:show={showRename}
    bind:value={renameValue}
/>
<Confirm
    confirmLabel="Delete instrument"
    destructive
    message={`Are you sure you want to delete instrument "${inst.name}"? All its notes in all patterns will be removed.`}
    onconfirm={onConfirmDelete}
    title="Delete Instrument"
    bind:show={showConfirmDelete}
/>
{#if contextualHelp}
    <Dialog
        onclose={() => (contextualHelp = null)}
        show={true}
        title={CONTROL_HELP[contextualHelp].title}
        width="440px"
    >
        <p class="contextual-help-text">{CONTROL_HELP[contextualHelp].text}</p>
        <details class="contextual-deep-dive">
            <summary>{CONTROL_HELP[contextualHelp].deepTitle}</summary>
            <div>
                {#each CONTROL_HELP[contextualHelp].deep as paragraph, i (i)}
                    <p>{paragraph}</p>
                {/each}
            </div>
        </details>
    </Dialog>
{/if}

<style>
    .instrument-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        padding: 0;
    }

    .instrument-picker {
        flex: 1;
        min-width: 180px;
        max-width: 420px;
    }

    .selected-instrument-actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .instrument-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-left: auto;
    }

    .audition-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 10px;
    }

    .ab-side {
        align-self: center;
        font-size: 11px;
        opacity: 0.6;
    }

    .inst-sliders {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
    }

    .sound-overview {
        min-width: 0;
        padding-left: 16px;
        border-left: 1px solid var(--border);
    }

    .inst-panel {
        display: grid;
        grid-template-rows: auto auto 42px minmax(0, 1fr);
        height: 100%;
        min-height: 0;
    }

    .editor-tabbar {
        box-sizing: border-box;
        display: flex;
        align-items: end;
        gap: 8px;
        height: 42px;
        padding-top: 8px;
    }

    .editor-tabs {
        display: flex;
        flex: 1;
        gap: 4px;
        border-bottom: 1px solid var(--border);
    }

    .editor-tabs button {
        padding: 7px 10px;
        border: 0;
        border-bottom: 2px solid transparent;
        border-radius: 4px 4px 0 0;
        background: transparent;
        color: var(--accent2);
        font-size: 11px;
    }

    .editor-tabs button.sel {
        border-bottom-color: var(--accent);
        background: var(--color-accent-soft);
        color: var(--text);
    }

    .tab-intro {
        display: flex;
        align-items: center;
        gap: 4px;
        margin: 8px 0;
        color: var(--accent2);
        font-size: 11px;
    }

    .group-heading {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .group-heading h4 {
        margin: 0;
    }

    .control-help {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--accent2);
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
    }

    .control-help:hover,
    .control-help:focus-visible {
        color: var(--accent);
    }

    .contextual-help-text {
        margin: 0;
        line-height: 1.5;
    }

    .contextual-deep-dive {
        margin-top: 14px;
        color: var(--text);
        line-height: 1.5;
    }

    .contextual-deep-dive summary {
        color: var(--accent2);
        cursor: pointer;
    }

    .contextual-deep-dive div {
        display: grid;
        gap: 10px;
        margin-top: 10px;
    }

    .contextual-deep-dive p {
        margin: 0;
    }

    .advanced-grid {
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 0;
    }

    .legato-default {
        display: grid;
        gap: 4px;
        color: var(--secondary-text);
        font-size: 11px;
    }

    .legato-default select {
        width: 100%;
        padding: 4px 6px;
        border: 1px solid var(--border);
        border-radius: 3px;
        background: var(--surface-input);
        color: var(--primary-text);
        font: inherit;
    }

    .tab-content {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(240px, 32%);
        gap: 16px;
        align-items: start;
        min-height: 0;
        overflow: visible;
    }

    .tab-controls {
        min-width: 0;
    }

    .starter-controls {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .group h4 {
        margin: 0 0 6px;
        font-size: 11px;
        color: var(--accent2);
        letter-spacing: 1px;
    }
</style>
