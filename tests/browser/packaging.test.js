import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('both manifests reference existing bundles and local UI scripts', async () => {
  for (const directory of [root, path.join(root, 'dist')]) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    const scripts = [manifest.background.service_worker, ...manifest.content_scripts.flatMap(c => c.js)];
    for (const script of scripts) {
      await access(path.join(directory, script));
      assert.equal(script.startsWith('dist/'), directory === root, script);
    }
    for (const htmlPath of [manifest.action.default_popup, manifest.options_page]) {
      const html = await readFile(path.join(directory, htmlPath), 'utf8');
      for (const [, script] of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
        const resolved = path.resolve(directory, path.dirname(htmlPath), script);
        assert.ok(resolved.startsWith(path.resolve(directory) + path.sep), 'UI script must stay inside its extension package');
        await access(resolved);
      }
    }
  }
});

test('standalone dist registers its worker, scans a page, and loads settings and popup', async () => {
  const directory = path.join(root, 'dist');
  const profile = await mkdtemp(path.join(tmpdir(), 'blackfish-dist-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + directory, '--load-extension=' + directory]
  });
  try {
    await context.route('**/*', route => {
      if (!/^https?:/.test(route.request().url())) return route.continue();
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local packaging fixture</title><p>Clean page</p>' });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const options = await context.newPage();
    await options.goto('chrome-extension://' + id + '/options/options.html');
    const settings = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }));
    assert.equal(settings.ok, true);
    await options.locator('#saveBtn').click();
    await options.getByText('Saved. AI advice never changes the local score or blocks a submission.', { exact: true }).waitFor();

    const page = await context.newPage();
    await page.goto('https://packaging.example.org/');
    await options.waitForFunction(async () => {
      for (const tab of await chrome.tabs.query({})) {
        const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 });
        if (frame?.url !== 'https://packaging.example.org/') continue;
        const result = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS', tabId: tab.id });
        return result?.state === 'complete' && result.scored.score === 0;
      }
      return false;
    });

    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + id + '/popup/popup.html');
    await popup.getByText('Page cannot be scanned', { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});
