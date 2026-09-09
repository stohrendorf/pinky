# pinky - an EQ-only DAW

A 100% vibe-coded browser-only DAW inspired by
[this song has no instruments in it (YouTube)](https://www.youtube.com/watch?v=_Rk-hmIMv6I) by Andy Brewer.

[Watch the Pinky promo video (MP4)](promo/out/pinky-promo.mp4) — its soundtrack is the
_Pinky Promo_ demo song, bounced through the DAW's own engine (see [promo/README.md](promo/README.md)).

The _Winter_ demo is Vivaldi's concerto RV 297, all three movements, note for note from the
[Mutopia Project](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=351) edition
(typeset by John Williams, CC BY-SA 3.0); see [score/winter/README.md](score/winter/README.md).

Human contributors are very welcome to improve this mess.

### Mixer

Open **Mixer** in the toolbar. Instrument strips are independent of the arranger
lanes: the same instrument in several patterns always feeds the same strip.
Its fader/pan are mix controls, separate from the instrument's synthesis gain/pan.
Balance channels with the vertical faders, pan and M/S buttons. Click a channel
name (or its output label) for routing and sends; expand **Tone & dynamics** only
when needed. Master stays visible while the channels scroll. Click **Master**
for reverb, tone and limiter settings; its limiter switch is always available.

- **Groups:** add a group and choose it in a strip's Output menu. Groups can feed
  other groups. Group mute also cuts its contributors' sends; solo works in place,
  preserving contributing sources and their effect returns.
- **Sends:** every strip has a post-fader send to the shared reverb. The master
  Reverb control (and existing `rev` automation) sets that return's level. Keep
  bass dry and send more flute/strings to the hall. Groups default to zero reverb
  send so grouping instruments does not accidentally double their ambience.
- **Effect channels:** click **+ Delay** and send a little signal to it. Echo
  returns are wet-only, with time/feedback controls; routing can include nested
  groups and parallel sends, but feedback cycles are blocked. Removing a bus
  reroutes its outputs to Master and removes sends targeting it.
- **Processing:** select a strip for high-pass, tilt EQ and optional compression.
  Master has drive, limiter ceiling, release, bypass, stereo peak/RMS meters and
  gain reduction. The limiter is stereo-linked, 5 ms look-ahead **sample-peak**
  protection, not a true-peak limiter or a LUFS loudness normalizer. Start with
  0 dB drive and a −1 dBFS ceiling; bypass is not clipping-safe.

Mixer settings travel with project JSON and undo/redo. Playback and WAV export
use the same processing; export trims the limiter delay and the playhead accounts
for it. Old projects retain their original mix until edited; new projects start
with protection enabled. Automation still controls master volume/reverb/tilt;
Stop restores the saved manual settings. Mixer controls are not yet automatable.

Bronze Monsoon, Winter and Pocket Theory demonstrate selective ambience and
groups without changing their scores. Monsoon adds a quiet dotted-eighth temple
echo on kora/handpan; Pocket adds subtle slap echo and gentle drum compression.
The faithful promo and other demos are deliberately left unchanged.

This is a focused mixer, not a plug-in host: no external effects, sidechain input,
pre-fader sends yet. Existing instrument and arranger
mute/solo controls still operate before the mixer.

Run `npm run test:audio` for isolated browser/UI and native audio routing/limiter
checks (requires installed Chrome/Edge, or `PINKY_BROWSER`). No dependencies are
downloaded and it does not modify saved projects.
Run `node scripts/check-mixer-ui.mjs` for mixer layout, keyboard, history and
mobile checks in Firefox (`npx playwright-core install firefox` first), or append
`chromium` for Chrome/Edge. These checks use isolated profiles, not your saved songs.

### Timeline markers

One strip below the ruler holds section names, BPM and time signatures. Changes
at the same position appear as one marker: click it to edit all three together.
Blank timing fields mean no change; clear a field to remove just that change.
The ruler shows bar numbers, not repeated signatures. Use it as usual to seek or
drag a loop.

Click empty lane space to place a **Marker** placeholder, or **+** to place one at
the cursor. Drag to move it; all its fields travel together. Moves snap to
sixteenths; arrow keys nudge by one step, or one beat with Shift. Escape cancels a
drag. A conflicting drop leaves both markers intact; non-conflicting fields can
share a position. Save closes the editor; Cancel/Escape discards unsaved field
edits. Delete removes the whole marker. Markers support saving and undo/redo.

Run `node scripts/check-markers.mjs firefox` (or `chromium`) for isolated browser
checks of grouped editing, dragging, cancellation, history and save/reload.

- **Tempo:** hold a BPM or ramp linearly in musical position to the next tempo
  marker. Before the first marker, the Studio BPM is used. Pattern preview always
  uses that base BPM; song playback, seeking and WAV export use the conductor.
- **Meter:** regroup the ruler without moving or stretching any notes or clips.
  A change starts a new bar, shortening the previous bar if placed inside it.
  Independent polymetric clips keep their own lengths.
- **Sections:** label passages without changing the audio. Markers beyond the
  last clip remain scrollable without extending the export.

Stop playback to edit timing: notes already scheduled into the audio graph cannot
be safely re-timed in place. Tempo ramps share one integrated timing model across
playback, note releases, portamento, automation and export. Envelope/reverb/echo
times remain in seconds; delay returns are not tempo-synchronised.

Bronze Monsoon now labels its 4/4 → 7/8 → 4/4 form correctly and has a restrained
82–90 BPM arc, plus named passages. Its notes, instrument patches, automation and
polymetric clips are unchanged. Winter has named sections but retains its
existing expanded note grid and performance; converting that edition to ordinary
sixteenths needs finer-than-sixteenth editing/scheduling and is not part of this
change. The faithful promo timing is unchanged.

### WAV export

**Render to WAV** opens a blocking progress dialog with preparation, score
scheduling, audio rendering and WAV encoding stages. **Cancel** (or Escape) stops
the export without downloading a partial file; playback and editing are restored
after cleanup. Audio progress measures processed audio time, not a guessed
wall-clock ETA. Long release, reverb and routed delay tails are included.

Run `npm run test:production` for isolated native-browser checks of conductor
editing/history, ruler loops, tempo-mapped WAV duration, export progress,
cancellation and immediate playback/retry (same browser requirements as
`test:audio`). Cancellation abandons a suspended offline context because browsers
provide no offline `close()` operation; memory reclamation is browser-controlled.
Browsers without offline `suspend()`/`resume()` support (including Firefox) get
rendering progress from frames processed by the output AudioWorklet, including
silence and effect tails. The dialog shows a smoothed, approximate time remaining
in the current stage after collecting enough measurements; encoding is separate.
In those browsers, cancellation still waits for native rendering to finish,
discards the result and never downloads a file. If a browser delays worklet
messages, the indicator waits for actual measurements rather than guessing.

`npm run test:export` checks in-flight progress, ETA, cancellation, playback recovery
and WAV output in an isolated Firefox profile (`npx playwright-core install firefox`
first). `npm run test:export -- chromium` checks the same telemetry path with pause
APIs masked in Chrome/Edge. Neither command touches your regular browser profile.
