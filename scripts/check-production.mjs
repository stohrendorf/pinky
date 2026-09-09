/* Native-browser conductor/export checks, using an isolated profile. */
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
    await server.listen();
    if (process.env.PINKY_BROWSER) {
        browser = await chromium.launch({
            executablePath: process.env.PINKY_BROWSER,
            args: ['--mute-audio'],
        });
    } else {
        for (const channel of ['chrome', 'msedge', 'chromium']) {
            try {
                browser = await chromium.launch({ channel, args: ['--mute-audio'] });
                break;
            } catch {
                /* try the next installed browser */
            }
        }
    }
    if (!browser) {
        throw new Error('Install Chrome/Edge or set PINKY_BROWSER.');
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [],
        downloads = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('download', download => downloads.push(download));
    await page.addInitScript(() => {
        // Observe real native contexts, without replacing their processing.
        const NativeOfflineContext = window.OfflineAudioContext;
        window.testOfflineContexts = [];
        window.OfflineAudioContext = class extends NativeOfflineContext {
            constructor(...args) {
                super(...args);
                window.testOfflineContexts.push(this);
                if (window.testNoOfflinePause) {
                    Object.defineProperty(this, 'suspend', { value: undefined });
                    Object.defineProperty(this, 'resume', { value: undefined });
                }
            }
        };
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.evaluate(async () => {
        const model = await import('/src/lib/project.ts');
        const p = model.newEmptyProject(),
            id = p.instruments[0].id;
        p.bpm = 120;
        p.instruments[0].params = {
            ...p.instruments[0].params,
            voices: 1,
            vib: 0,
            noise: 0,
            tone: 1,
            q: 10,
            partials: [
                { ratio: 1, level: 1 },
                { ratio: 2, level: 0.3 },
            ],
            gain: 0.3,
            rel: 0.04,
        };
        p.patterns[0].tracks[id] = [
            { pitch: 'C5', start: 0, len: 2 },
            { pitch: 'G5', start: 8, len: 2 },
        ];
        model.project.set(p);
        model.selPatId.set(p.patterns[0].id);
        model.selInstId.set(id);
        window.testSong = JSON.parse(JSON.stringify(p));
        window.testProgress = [];
        (await import('/src/lib/render.ts')).exportProgress.subscribe(state => {
            if (state) {
                window.testProgress.push({ ...state });
            }
        });
    });
    const conductor = page.getByRole('dialog', { name: /^(Add|Edit) marker$/ });
    const addMarker = async step => {
        const marker = page.locator(`.conductor button[data-step="${step}"]`);
        if (!(await marker.count())) {
            const lane = await page.locator('.conductor-lanes').boundingBox();
            const width = await page.evaluate(async () => {
                const { project } = await import('/src/lib/project.ts');
                let p;
                project.subscribe(value => {
                    p = value;
                })();
                return p.zoom.arr.width;
            });
            await page.mouse.click(lane.x + step * width, lane.y + 12);
            assert.equal(
                await conductor.count(),
                0,
                'adding places a placeholder without opening a dialog',
            );
        }
        await marker.click();
        assert.equal(
            await conductor.getByLabel('Exact step (0-based)', { exact: true }).count(),
            0,
        );
    };
    const saveMarker = async () => {
        await conductor.getByRole('button', { name: 'Save', exact: true }).click();
        await conductor.waitFor({ state: 'hidden' });
    };
    await addMarker(0);
    await conductor.getByLabel('Title', { exact: true }).fill('First rain');
    await conductor.getByLabel('BPM', { exact: true }).fill('120');
    await conductor.getByLabel('Time signature', { exact: true }).fill('7/8');
    await conductor.getByLabel('Gradually change to the next tempo').check();
    await saveMarker();
    await addMarker(16);
    await conductor.getByLabel('Title', { exact: true }).fill('');
    await conductor.getByLabel('BPM', { exact: true }).fill('60');
    await saveMarker();
    await addMarker(14);
    await conductor.getByLabel('Title', { exact: true }).fill('Seven steps');
    await saveMarker();
    assert.equal(
        await page.locator('.conductor').evaluate(node => node.getBoundingClientRect().height),
        28,
        'one compact strip replaces the three lanes',
    );
    assert.equal(
        await page.locator('.conductor .marker').count(),
        3,
        'coincident markers share one flag',
    );
    assert.equal(await page.locator('.conductor select').count(), 0, 'no marker picker');
    assert.equal(
        await page.locator('.time-marker span').count(),
        0,
        'the ruler does not repeat time signatures',
    );
    await page.getByRole('button', { name: /^Edit First rain/ }).click();
    assert.equal(await conductor.getByLabel('BPM', { exact: true }).inputValue(), '120');
    assert.equal(
        await conductor.getByLabel('Gradually change to the next tempo').isChecked(),
        true,
    );
    assert.equal(await conductor.getByLabel('Time signature', { exact: true }).inputValue(), '7/8');
    assert.equal(await conductor.getByLabel('Title', { exact: true }).inputValue(), 'First rain');
    assert.equal(
        await conductor.getByRole('button', { name: /Jump here|Loop section|Clear loop/ }).count(),
        0,
    );
    assert.equal(
        await conductor.getByRole('group', { name: 'Markers at this position' }).count(),
        0,
        'no second marker selector inside the editor',
    );
    await page.keyboard.press('Escape');
    await conductor.waitFor({ state: 'hidden' });
    const edited = await page.evaluate(async () => {
        const { project } = await import('/src/lib/project.ts');
        let p;
        project.subscribe(value => {
            p = value;
        })();
        return {
            conductor: p.conductor,
            loop: p.loop,
            patterns: p.patterns,
            original: window.testSong.patterns,
        };
    });
    assert.equal(edited.loop ?? null, null, 'opening markers leaves the loop alone');
    assert.deepEqual(edited.patterns, edited.original, 'meter changes must not move notes');
    assert.deepEqual(
        edited.conductor.tempos.map(marker => [marker.step, marker.bpm]),
        [
            [0, 120],
            [16, 60],
        ],
    );
    const lane = await page.locator('.conductor-lanes').boundingBox();
    const barWidth = (await page.getByTitle('Bar 1 · 7/8 · step 0', { exact: true }).boundingBox())
        .width;
    await page.mouse.click(lane.x + barWidth * 2, lane.y + 12);
    const placeholder = page.locator('.conductor button[data-step="28"]');
    await placeholder.waitFor();
    assert.equal(await conductor.count(), 0, 'clicking the lane only creates a placeholder');
    await placeholder.click();
    await page.waitForFunction(
        () => document.querySelector('.conductor-editor .marker-value') === document.activeElement,
    );
    assert.equal(
        await conductor
            .getByLabel('Title', { exact: true })
            .evaluate(node => node === document.activeElement),
        true,
        'focus starts on the useful field',
    );
    await conductor.getByLabel('BPM', { exact: true }).fill('29');
    await conductor.getByRole('button', { name: 'Save', exact: true }).click();
    await conductor.getByRole('alert').waitFor();
    await conductor.getByLabel('Title', { exact: true }).fill('Unsaved');
    if (process.argv.includes('--screenshot')) {
        await page.screenshot({ path: join(root, 'marker-editor-check.png') });
    }
    await conductor.getByRole('button', { name: 'Save', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(
        await conductor.evaluate(node => node.contains(document.activeElement)),
        true,
        'marker editor traps Tab',
    );
    await page.keyboard.press('Escape');
    assert.equal(
        await placeholder.evaluate(node => node === document.activeElement),
        true,
        'Escape restores focus',
    );
    await page.getByTitle('Bar 2 · 7/8 · step 14', { exact: true }).waitFor();
    const firstBar = await page.getByTitle('Bar 1 · 7/8 · step 0', { exact: true }).boundingBox();
    const secondBar = await page.getByTitle('Bar 2 · 7/8 · step 14', { exact: true }).boundingBox();
    await page.mouse.move(firstBar.x + 1, firstBar.y + 8);
    await page.mouse.down();
    await page.mouse.move(secondBar.x + 1, secondBar.y + 8, { steps: 4 });
    await page.mouse.up();
    const draggedLoop = await page.evaluate(async () => {
        const { project } = await import('/src/lib/project.ts');
        let p;
        project.subscribe(value => {
            p = value;
        })();
        return p.loop;
    });
    assert.deepEqual(
        draggedLoop,
        { start: 0, end: 14 },
        'dragged loops snap to real 7/8 beat boundaries',
    );
    await page.mouse.click(firstBar.x + 1, firstBar.y + 8, { button: 'right' });
    await page.getByTitle('Play Song', { exact: true }).click();
    await page.waitForFunction(
        () => document.querySelector('button[title="Stop"]')?.disabled === false,
    );
    await page.getByRole('button', { name: /^Edit First rain/ }).click();
    assert.equal(await conductor.getByLabel('Title', { exact: true }).isDisabled(), true);
    assert.equal(
        await conductor.getByRole('button', { name: 'Save', exact: true }).isDisabled(),
        true,
    );
    await page.keyboard.press('Escape');
    await page.getByTitle('Stop', { exact: true }).click();

    // History operates on the complete conductor data, including removals.
    await page.evaluate(async () => {
        // History deliberately coalesces edits until 350 ms of quiet.
        await new Promise(resolve => setTimeout(resolve, 400));
        const { project, touch } = await import('/src/lib/project.ts');
        const { undo, redo } = await import('/src/lib/history.ts');
        let p;
        project.subscribe(value => {
            p = value;
        })();
        const before = JSON.stringify(p.conductor);
        p.conductor.sections[0].name = 'Undo probe';
        touch();
        undo();
        project.subscribe(value => {
            p = value;
        })();
        if (JSON.stringify(p.conductor) !== before) {
            throw new Error('Conductor undo did not restore markers');
        }
        redo();
        project.subscribe(value => {
            p = value;
        })();
        if (p.conductor.sections[0].name !== 'Undo probe') {
            throw new Error('Conductor redo failed');
        }
        window.testSong = JSON.parse(JSON.stringify(p));
        const long = JSON.parse(JSON.stringify(p));
        long.arrangement[0].len = 512;
        project.set(long);
    });
    await page.getByRole('button', { name: 'Pinky application menu', exact: true }).click();
    const exportButton = page.getByRole('button', { name: 'Render WAV', exact: true });
    await exportButton.click();
    const exporting = page.getByRole('dialog', { name: 'Export WAV', exact: true });
    await exporting.waitFor();
    await page.waitForFunction(() =>
        window.testProgress.some(state => state.stage === 'rendering' && state.progress > 0),
    );
    assert.equal(
        await exporting.evaluate(node => node.contains(document.activeElement)),
        true,
        'export owns keyboard focus',
    );
    await page.keyboard.press('Tab');
    assert.equal(
        await exporting.evaluate(node => node.contains(document.activeElement)),
        true,
        'Tab remains in export',
    );
    if (process.argv.includes('--screenshot')) {
        await page.screenshot({ path: join(root, 'export-check.png') });
    }
    const cancelStarted = Date.now();
    await page.keyboard.press('Escape');
    await exporting.waitFor({ state: 'hidden', timeout: 10000 });
    const cancelMs = Date.now() - cancelStarted;
    const stopped = await page.evaluate(async () => {
        const context = window.testOfflineContexts.at(-1);
        const at = context.currentTime;
        await new Promise(resolve => setTimeout(resolve, 150));
        const engine = await import('/src/lib/engine.ts');
        return {
            state: context.state,
            at,
            later: context.currentTime,
            rendering: engine.isRendering(),
        };
    });
    assert.deepEqual(stopped, {
        ...stopped,
        state: 'suspended',
        later: stopped.at,
        rendering: false,
    });
    assert.equal(downloads.length, 0, 'cancel must never download a partial file');
    await page.getByTitle('Play Pattern', { exact: true }).click();
    await page.getByRole('button', { name: 'Mixer', exact: true }).click();
    await page.waitForFunction(
        () =>
            Number(
                document
                    .querySelector('[role="meter"][aria-label="Master L peak"]')
                    ?.getAttribute('aria-valuenow') ?? -60,
            ) > -60,
    );
    await page.keyboard.press('Escape');
    await page.getByTitle('Stop', { exact: true }).click();

    // Retry through the UI and inspect the actual downloaded RIFF header.
    const expectedFrames = await page.evaluate(async () => {
        const { project } = await import('/src/lib/project.ts');
        const { createTimingMap } = await import('/src/lib/timing.ts');
        project.set(JSON.parse(JSON.stringify(window.testSong)));
        window.testProgress = [];
        const p = window.testSong;
        return Math.ceil(
            (createTimingMap(p).secondsBetween(0, 32) + 3 + 1.5 * p.instruments[0].params.rel) *
                44100,
        );
    });
    await page.getByRole('button', { name: 'Pinky application menu', exact: true }).click();
    const downloadEvent = page.waitForEvent('download', { timeout: 30000 });
    await exportButton.click();
    const download = await downloadEvent;
    await exporting.waitFor({ state: 'hidden' });
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    const wav = Buffer.concat(chunks);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 44100);
    assert.equal(
        wav.readUInt32LE(40),
        expectedFrames * 4,
        'WAV length includes integrated tempo ramp + tails',
    );
    assert.equal(wav.length, 44 + expectedFrames * 4);
    const stages = await page.evaluate(() => window.testProgress);
    for (const stage of ['scheduling', 'rendering', 'encoding']) {
        const values = stages.filter(state => state.stage === stage).map(state => state.progress);
        assert.ok(values.length > 1 && values.at(-1) === 1, `${stage} reports completion`);
        assert.ok(
            values.every((value, index) => index === 0 || value >= values[index - 1]),
            `${stage} never regresses`,
        );
    }
    const encodingCancellation = await page.evaluate(async () => {
        const { exportWav } = await import('/src/lib/render.ts');
        const controller = new AbortController();
        const message = await exportWav({
            signal: controller.signal,
            onProgress: state => {
                if (state.stage === 'encoding' && state.progress > 0) {
                    controller.abort();
                }
            },
        });
        return { message, aborted: controller.signal.aborted };
    });
    assert.deepEqual(encodingCancellation, { message: '', aborted: true });
    assert.equal(downloads.length, 1, 'encoding cancellation also suppresses downloads');

    // Exercise the compatibility path with native DSP, masking only the
    // optional pause APIs. This does not substitute for testing other browsers.
    await page.evaluate(async () => {
        window.testNoOfflinePause = true;
        window.testProgress = [];
        const p = JSON.parse(JSON.stringify(window.testSong));
        p.arrangement[0].len = 128;
        (await import('/src/lib/project.ts')).project.set(p);
    });
    await page.getByRole('button', { name: 'Pinky application menu', exact: true }).click();
    await exportButton.click();
    await page.waitForFunction(() =>
        window.testProgress.some(
            state => state.stage === 'rendering' && state.progress > 0 && state.progress < 1,
        ),
    );
    assert.notEqual(
        await exporting.locator('progress').getAttribute('value'),
        null,
        'worklet reports progress without pause APIs',
    );
    assert.match(await exporting.innerText(), /Cancellation waits for rendering to finish/);
    await page.keyboard.press('Escape');
    await exporting.waitFor({ state: 'hidden', timeout: 30000 });
    const fallbackStopped = await page.evaluate(async () => ({
        state: window.testOfflineContexts.at(-1).state,
        rendering: (await import('/src/lib/engine.ts')).isRendering(),
        cancelled: window.testProgress.some(state => state.cancelling),
        encoded: window.testProgress.some(state => state.stage === 'encoding'),
    }));
    assert.deepEqual(fallbackStopped, {
        state: 'closed',
        rendering: false,
        cancelled: true,
        encoded: false,
    });
    assert.equal(downloads.length, 1, 'fallback cancellation discards the completed render');
    await page.getByTitle('Play Pattern', { exact: true }).click();
    await page.getByRole('button', { name: 'Mixer', exact: true }).click();
    await page.waitForFunction(
        () =>
            Number(
                document
                    .querySelector('[role="meter"][aria-label="Master L peak"]')
                    ?.getAttribute('aria-valuenow') ?? -60,
            ) > -60,
    );
    await page.keyboard.press('Escape');
    await page.getByTitle('Stop', { exact: true }).click();
    await page.evaluate(async () => {
        window.testProgress = [];
        (await import('/src/lib/project.ts')).project.set(
            JSON.parse(JSON.stringify(window.testSong)),
        );
    });
    await page.getByRole('button', { name: 'Pinky application menu', exact: true }).click();
    const fallbackDownloadEvent = page.waitForEvent('download', { timeout: 30000 });
    await exportButton.click();
    const fallbackDownload = await fallbackDownloadEvent;
    await exporting.waitFor({ state: 'hidden' });
    const fallbackChunks = [];
    for await (const chunk of await fallbackDownload.createReadStream()) {
        fallbackChunks.push(chunk);
    }
    const fallbackWav = Buffer.concat(fallbackChunks);
    assert.deepEqual(
        fallbackWav.subarray(0, 44),
        wav.subarray(0, 44),
        'fallback preserves WAV format and exact duration',
    );
    assert.ok(
        fallbackWav.subarray(44).some(value => value !== 0),
        'fallback renders actual audio, not silence',
    );
    const fallbackProgress = await page.evaluate(() =>
        window.testProgress
            .filter(state => state.stage === 'rendering')
            .map(state => state.progress),
    );
    const measured = fallbackProgress.filter(value => typeof value === 'number');
    assert.equal(measured[0], 0);
    assert.equal(measured.at(-1), 1);
    assert.ok(
        measured.some(value => value > 0 && value < 1),
        'actual frame updates before completion',
    );
    assert.ok(measured.every((value, i) => i === 0 || value >= measured[i - 1]));
    assert.equal(downloads.length, 2, 'only successful renders download files');
    await page.evaluate(() => {
        window.testNoOfflinePause = false;
    });

    await page.evaluate(async () =>
        (await import('/src/lib/project.ts')).loadDemoProject('monsoon'),
    );
    const seven = page.getByRole('button', { name: /^Edit Seven Rains/ });
    await page.locator('.grid-viewport').evaluate(async node => {
        const { project } = await import('/src/lib/project.ts');
        let p;
        project.subscribe(value => {
            p = value;
        })();
        node.scrollLeft = 384 * p.zoom.arr.width - 40;
    });
    await seven.click();
    assert.equal(await conductor.getByLabel('Title', { exact: true }).inputValue(), 'Seven Rains');
    assert.equal(await conductor.getByLabel('Time signature', { exact: true }).inputValue(), '7/8');
    await page.keyboard.press('Escape');
    await page.mouse.move(20, 20);
    if (process.argv.includes('--screenshot')) {
        await page.screenshot({ path: join(root, 'conductor-check.png') });
    }
    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log(
        JSON.stringify(
            {
                browser: browser.version(),
                conductor:
                    'direct lane editing, no picker/repeated meters, real 7/8 ruler, ruler loop, history, playback lock and scrolling passed',
                export: {
                    cancelMs,
                    stopped,
                    frames: expectedFrames,
                    wavBytes: wav.length,
                    stages: [...new Set(stages.map(state => state.stage))],
                    downloads: downloads.length,
                    fallback: {
                        stopped: fallbackStopped,
                        progress: fallbackProgress,
                        wavBytes: fallbackWav.length,
                    },
                    checks: 'native suspension, missing pause APIs, focus, Escape, live playback recovery, retry, encoding cancel',
                },
            },
            null,
            2,
        ),
    );
} finally {
    await browser?.close();
    await server.close();
}
