import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const svg = await readFile(new URL('../assets/xelu-mark.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  for (const warning of [false, true]) {
    const art = warning ? svg.replaceAll('#f2f2ef', '#ed9cae') : svg;
    for (const size of [16, 32, 48, 128]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent('<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style>' + art);
      const output = await page.screenshot({ omitBackground: true });
      await writeFile(new URL('../icons/icon' + (warning ? '-warn' : '') + size + '.png', import.meta.url), output);
    }
  }
} finally { await browser.close(); }
console.log('Rendered the original xelulabs mark to the extension icon sizes.');
