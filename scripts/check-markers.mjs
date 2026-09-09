/* Isolated native-browser checks for grouped marker editing and pointer dragging. */
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright-core';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserName = process.argv[2] ?? 'firefox';
assert.ok(['firefox', 'chromium'].includes(browserName));
const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
    await server.listen();
    if (browserName === 'firefox') {
        browser = await firefox.launch();
    } else if (process.env.PINKY_BROWSER) {
        browser = await chromium.launch({ executablePath: process.env.PINKY_BROWSER });
    } else {
        for (const channel of ['chrome', 'msedge', 'chromium']) {
            try {
                browser = await chromium.launch({ channel });
                break;
            } catch {
                /* next installed browser */
            }
        }
    }
    assert.ok(browser, 'Install a supported browser first');
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.evaluate(async () =>
        (await import('/src/lib/project.ts')).loadDemoProject('monsoon'),
    );
    const data = () =>
        page.evaluate(async () => {
            const { project } = await import('/src/lib/project.ts');
            let p;
            project.subscribe(value => {
                p = value;
            })();
            return p.conductor;
        });
    const marker = step => page.locator(`.conductor button[data-step="${step}"]`);
    const editor = page.getByRole('dialog', { name: 'Edit marker', exact: true });
    const before = await data();
    assert.equal(
        await page.locator('.conductor .marker button').count(),
        new Set(
            Object.values(before)
                .flat()
                .map(item => item.step),
        ).size,
        'one button per musical position',
    );
    await marker(0).click();
    assert.equal(
        await editor.getByLabel('Title', { exact: true }).inputValue(),
        before.sections[0].name,
    );
    assert.equal(
        await editor.getByLabel('BPM', { exact: true }).inputValue(),
        String(before.tempos[0].bpm),
    );
    assert.equal(await editor.getByLabel('Time signature', { exact: true }).inputValue(), '4/4');
    assert.equal(await editor.getByLabel('Exact step (0-based)').count(), 0);
    await editor.getByLabel('Title', { exact: true }).fill('Rain edited');
    await editor.getByLabel('BPM', { exact: true }).fill('100');
    await editor.getByLabel('Time signature', { exact: true }).fill('5/4');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    const edited = await data();
    assert.deepEqual(edited.sections[0], { ...before.sections[0], name: 'Rain edited' });
    assert.deepEqual(edited.tempos[0], { ...before.tempos[0], bpm: 100 });
    assert.deepEqual(edited.meters[0], { ...before.meters[0], numerator: 5 });
    await page.evaluate(async () => (await import('/src/lib/history.ts')).undo());
    assert.deepEqual(await data(), before, 'one undo restores all edited fields');

    await page.evaluate(async () => {
        const model = await import('/src/lib/project.ts');
        const p = model.newEmptyProject();
        p.zoom.arr.width = 12;
        p.conductor = {
            sections: [
                { id: crypto.randomUUID(), step: 0, name: 'Intro' },
                {
                    id: crypto.randomUUID(),
                    step: 32,
                    name: 'Verse',
                },
            ],
            tempos: [
                { id: crypto.randomUUID(), step: 0, bpm: 90, curve: 'linear' },
                {
                    id: crypto.randomUUID(),
                    step: 16,
                    bpm: 120,
                    curve: 'hold',
                },
            ],
            meters: [{ id: crypto.randomUUID(), step: 0, numerator: 7, denominator: 8 }],
        };
        model.project.set(p);
        window.markerMusic = JSON.stringify({
            arrangement: p.arrangement,
            patterns: p.patterns,
            loop: p.loop,
            bpm: p.bpm,
        });
    });
    const initial = await data();
    const drag = async (from, to, { cancel = false, hold = false } = {}) => {
        const button = marker(from);
        const box = await button.boundingBox();
        assert.ok(box);
        await page.mouse.move(box.x + 8, box.y + box.height / 2);
        assert.equal(
            await page.evaluate(
                ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-step'),
                {
                    x: box.x + 8,
                    y: box.y + box.height / 2,
                },
            ),
            String(from),
            `marker ${from} must be reachable: ${JSON.stringify(
                await page.evaluate(() =>
                    [
                        ...document.querySelectorAll(
                            '.conductor-viewport, .conductor-lanes, .grid-viewport',
                        ),
                    ].map(node => ({
                        class: node.className,
                        scroll: node.scrollLeft,
                        x: node.getBoundingClientRect().x,
                        width: node.getBoundingClientRect().width,
                        transform: getComputedStyle(node).transform,
                    })),
                ),
            )}`,
        );
        await page.mouse.down();
        await page.mouse.move(box.x + 8 + (to - from) * 12, box.y + box.height / 2, { steps: 8 });
        if (hold) {
            await page.waitForTimeout(450);
            assert.deepEqual(
                await data(),
                initial,
                'holding a drag preview does not mutate history or timing',
            );
        }
        if (cancel) {
            await page.keyboard.press('Escape');
        }
        await page.mouse.up();
        assert.equal(await editor.count(), 0, 'releasing a drag does not open the editor');
    };
    await drag(0, 8, { hold: true });
    await marker(8).waitFor();
    const moved = await data();
    for (const kind of ['sections', 'tempos', 'meters']) {
        assert.deepEqual(
            moved[kind].find(item => item.id === initial[kind][0].id),
            { ...initial[kind][0], step: 8 },
        );
    }
    await page.evaluate(async () => (await import('/src/lib/history.ts')).undo());
    assert.deepEqual(await data(), initial, 'drag is one undo step');
    await page.evaluate(async () => (await import('/src/lib/history.ts')).redo());
    assert.deepEqual(await data(), moved);
    await drag(8, 12, { cancel: true });
    assert.deepEqual(await data(), moved, 'Escape leaves the group in place');
    await drag(8, 16);
    assert.deepEqual(await data(), moved, 'conflicting drop never overwrites the other tempo');
    await marker(8).click();
    await editor.waitFor();
    await page.keyboard.press('Escape');

    const lane = await page.locator('.conductor-lanes').boundingBox();
    await page.mouse.click(lane.x + 48 * 12, lane.y + 12);
    await marker(48).waitFor();
    assert.equal(await marker(48).innerText(), 'Marker');
    assert.equal(await editor.count(), 0, 'creation leaves a movable placeholder');
    assert.deepEqual((await data()).tempos, moved.tempos, 'adding a marker does not change timing');
    await drag(48, 24);
    await marker(24).focus();
    await page.keyboard.press('ArrowRight');
    await marker(25).waitFor();
    await page.keyboard.press('Shift+ArrowRight');
    await marker(27).waitFor();
    await page.keyboard.press('Enter');
    await editor.waitFor();
    assert.equal(await editor.getByLabel('BPM', { exact: true }).inputValue(), '');
    assert.equal(await editor.getByLabel('Time signature', { exact: true }).inputValue(), '');
    await editor.getByLabel('BPM', { exact: true }).fill('29');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.getByRole('alert').waitFor();
    await editor.getByRole('button', { name: 'Save', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.ok(
        await editor.evaluate(node => node.contains(document.activeElement)),
        'focus stays inside the dialog',
    );
    if (process.argv.includes('--screenshot')) {
        await page.screenshot({ path: resolve(root, 'marker-group-editor.png') });
    }
    await page.keyboard.press('Escape');
    assert.ok(
        await marker(27).evaluate(node => node === document.activeElement),
        'focus returns to the marker',
    );
    await page.locator('.grid-viewport').evaluate(node => {
        node.scrollLeft = 100;
    });
    await page.waitForFunction(() => {
        const lane = document.querySelector('.conductor-lanes');
        const grid = document.querySelector('.grid-viewport');
        return new DOMMatrix(getComputedStyle(lane).transform).m41 === -grid.scrollLeft;
    });
    await drag(27, 23);
    assert.ok(
        (await data()).sections.some(item => item.step === 23),
        JSON.stringify(await data()),
    );
    await marker(23).click();
    await editor.getByLabel('Title', { exact: true }).fill('Moved placeholder');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    const persisted = await data();
    assert.equal(persisted.sections.find(item => item.step === 23).name, 'Moved placeholder');
    assert.ok(
        await page.evaluate(async () => {
            const { project } = await import('/src/lib/project.ts');
            let p;
            project.subscribe(value => {
                p = value;
            })();
            return (
                JSON.stringify({
                    arrangement: p.arrangement,
                    patterns: p.patterns,
                    loop: p.loop,
                    bpm: p.bpm,
                }) === window.markerMusic
            );
        }),
        'marker edits leave music, cursor-independent loop and base BPM untouched',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.reload();
    assert.deepEqual(await data(), persisted, 'grouped edits and moves survive save/reload');
    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log(
        JSON.stringify({
            browser: browserName,
            version: browser.version(),
            checks: 'Monsoon grouped fields, IDs, pointer capture, drag preview/drop, undo/redo, Escape, collisions, placeholders, arrow keys, scroll, save/reload',
        }),
    );
} finally {
    await browser?.close();
    await server.close();
}
