/* Desktop toolbar checks in an isolated Chromium profile. */
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const server = await createServer({
    root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    logLevel: 'silent',
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
                /* next installed browser */
            }
        }
    }
    assert.ok(browser, 'Install Chromium or set PINKY_BROWSER');
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    const demos = page.getByRole('button', { name: 'Demos', exact: true });
    await demos.waitFor();
    await page.evaluate(() => document.fonts.ready);

    assert.equal(await page.locator('a.brand, button.brand, .brand[tabindex]').count(), 0);
    assert.equal(
        await page
            .locator('.brand')
            .textContent()
            .then(text => text.trim()),
        'Pinky',
    );
    await page.getByRole('button', { name: 'Keyboard shortcuts (?)', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'Keyboard Shortcuts', exact: true });
    await help.waitFor();
    assert.equal(
        await help.getByRole('link', { name: 'Pinky on GitHub' }).getAttribute('href'),
        'https://github.com/stohrendorf/pinky',
    );
    await page.keyboard.press('Escape');

    const save = page.getByRole('button', { name: 'Save', exact: true });
    const saveWidth = await save.evaluate(node => node.getBoundingClientRect().width);
    for (let i = 0; i < 2; i++) {
        await save.click();
        await page.waitForFunction(() => document.querySelector('.save-icon .fa-check'));
        assert.equal(await save.locator('.save-icon').count(), 1);
        assert.equal(await save.evaluate(node => node.getBoundingClientRect().width), saveWidth);
        await page.waitForFunction(() => document.querySelector('.saved-flash').textContent === '');
        assert.equal(await save.locator('.fa-check').count(), 0);
        assert.equal(await save.locator('.save-icon').count(), 1);
    }
    await page.keyboard.press('Control+s');
    await page.waitForFunction(
        () => document.querySelector('.saved-flash').textContent === 'Saved',
    );

    const baseline = await page.evaluate(async () => {
        const p = await import('/src/lib/project.ts');
        const read = store => {
            let value;
            const off = store.subscribe(v => (value = v));
            off();
            return value;
        };
        window.readToolbarState = () => ({
            project: read(p.project),
            pattern: read(p.selPatId),
            instrument: read(p.selInstId),
            cursor: read(p.songCursor),
        });
        p.songCursor.set(32);
        return JSON.stringify(window.readToolbarState());
    });

    await demos.focus();
    await page.keyboard.press('Space');
    const panel = page.getByRole('dialog', { name: 'Demo songs', exact: true });
    await panel.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).isDisabled(), true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => JSON.stringify(window.readToolbarState())), baseline);
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await demos.evaluate(node => node === document.activeElement), true);

    for (const name of ['Toccata', 'Pocket Theory']) {
        await demos.click();
        await panel.getByRole('button', { name, exact: true }).click();
        await panel.waitFor({ state: 'hidden' });
    }
    await demos.click();
    await panel.getByRole('button', { name: 'Restore previous project', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => JSON.stringify(window.readToolbarState())), baseline);
    await page.evaluate(() => structuredClone(window.readToolbarState()));
    await page.getByRole('button', { name: 'Mixer', exact: true }).click();
    await page.getByRole('dialog', { name: 'Mixer', exact: true }).waitFor();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Audio', exact: true }).click();
    await page.getByRole('dialog', { name: 'Audio', exact: true }).waitFor();
    await page.getByRole('spinbutton', { name: 'Tempo (BPM)', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);

    const audition = page.getByRole('button', { name: 'Play pattern', exact: true });
    assert.equal(
        await page.locator('.topbar').getByRole('button', { name: 'Play pattern' }).count(),
        0,
    );
    assert.equal(
        await page.locator('.editor-toolbar').getByRole('button', { name: 'Play pattern' }).count(),
        1,
    );
    await audition.click();
    await page.waitForFunction(
        () => document.querySelector('.pattern-preview').getAttribute('aria-pressed') === 'true',
    );
    assert.equal(await audition.isEnabled(), true, 'audition remains stoppable while playing');
    assert.equal(await audition.locator('.fa-stop').count(), 1);
    await audition.click();
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    assert.equal(await stop.isDisabled(), true);
    assert.equal(await audition.getAttribute('aria-pressed'), 'false');
    await audition.focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(
        () => document.querySelector('.pattern-preview').getAttribute('aria-pressed') === 'true',
    );
    await page.keyboard.press('Space');
    assert.equal(await audition.getAttribute('aria-pressed'), 'false');
    await page.getByRole('button', { name: 'Play song', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Stop"]').disabled);
    assert.equal(await audition.getAttribute('aria-pressed'), 'false');
    await audition.click();
    await page.waitForFunction(
        () => document.querySelector('.pattern-preview').getAttribute('aria-pressed') === 'true',
    );
    await stop.click();
    assert.equal(await audition.getAttribute('aria-pressed'), 'false');

    const exports = page.getByRole('button', { name: 'Export', exact: true });
    const exportPanel = page.getByRole('dialog', { name: 'Export', exact: true });
    const json = page.getByRole('button', { name: 'Project file (.json)', exact: true });
    const wav = page.getByRole('button', { name: 'Audio (.wav)', exact: true });
    assert.equal(await json.count(), 0);
    assert.equal(await wav.count(), 0);
    await exports.focus();
    await page.keyboard.press('Space');
    await exportPanel.waitFor();
    assert.equal(await json.evaluate(node => node === document.activeElement), true);
    const triggerBounds = await exports.boundingBox();
    const panelBounds = await exportPanel.boundingBox();
    assert.ok(Math.abs(triggerBounds.x - panelBounds.x) < 2, 'dropdown is anchored to Export');
    await page.keyboard.press('ArrowDown');
    assert.equal(await wav.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    await exportPanel.waitFor({ state: 'hidden' });
    assert.equal(await exports.evaluate(node => node === document.activeElement), true);
    await exports.click();
    await demos.click();
    await panel.waitFor();
    assert.equal(await exportPanel.count(), 0, 'only one toolbar dropdown is open');
    await exports.click();
    await exportPanel.waitFor();
    assert.equal(await panel.count(), 0);
    assert.equal(await json.evaluate(node => node === document.activeElement), true);
    await page.getByRole('spinbutton', { name: 'Tempo (BPM)', exact: true }).click();
    assert.equal(await exportPanel.count(), 0);

    await exports.click();
    const jsonDownload = page.waitForEvent('download');
    await json.click();
    assert.match((await jsonDownload).suggestedFilename(), /\.json$/);
    assert.equal(await exportPanel.count(), 0);
    assert.equal(await exports.evaluate(node => node === document.activeElement), true);

    await page.evaluate(async () => {
        const model = await import('/src/lib/project.ts');
        const p = model.newEmptyProject();
        p.arrangement[0].len = 1;
        p.patterns[0].tracks[p.instruments[0].id] = [{ pitch: 'C5', start: 0, len: 1 }];
        model.project.set(p);
        model.selPatId.set(p.patterns[0].id);
        model.selInstId.set(p.instruments[0].id);
    });
    await exports.click();
    const wavDownload = page.waitForEvent('download', { timeout: 60000 });
    await wav.click();
    assert.equal(await exportPanel.count(), 0);
    const download = await wavDownload;
    assert.match(download.suggestedFilename(), /\.wav$/);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) {
        chunks.push(chunk);
    }
    assert.equal(Buffer.concat(chunks).toString('ascii', 0, 4), 'RIFF');
    await page
        .getByRole('dialog', { name: 'Export WAV', exact: true })
        .waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Export');

    for (const width of [1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.evaluate(() => ({
            height: document.querySelector('.topbar-main').getBoundingClientRect().height,
            clipped: [
                ...document.querySelectorAll('.topbar-main button, .topbar-main input'),
            ].filter(node => node.getBoundingClientRect().right > innerWidth).length,
            transportText: document.querySelector('.transport-controls').textContent.trim(),
        }));
        assert.deepEqual(layout, { height: 48, clipped: 0, transportText: '' });
    }
    assert.deepEqual(errors, [], 'No browser exceptions during toolbar interactions');
    console.log(
        'TopBar: branding/help, pattern toggle, JSON/WAV exports, save feedback, keyboard, demo recovery, Mixer, Audio and desktop layout passed.',
    );
} finally {
    await browser?.close();
    await server.close();
}
