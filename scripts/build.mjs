import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
await mkdir(out, { recursive: true });
for (const [entry, format] of [
  ['background/service-worker.js', 'esm'], ['content/content-script.js', 'iife'],
  ['popup/popup.js', 'iife'], ['options/options.js', 'iife']
]) {
  const result = await build({ entryPoints: [path.join(root, entry)], outfile: path.join(out, entry), bundle: true, format, target: 'chrome116', legalComments: 'eof', metafile: true });
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.imports.some(item => item.external)) throw new Error('Extension bundles must not contain external imports: ' + entry);
  }
}
for (const f of ['icons', 'assets', 'ui/theme.css', 'popup/popup.html', 'popup/popup.css', 'options/options.html', 'options/options.css', 'PRIVACY.md', 'privacy.html']) {
  await mkdir(path.dirname(path.join(out, f)), { recursive: true });
  await cp(path.join(root, f), path.join(out, f), { recursive: true });
  if (f.endsWith('.html')) {
    const html = await readFile(path.join(root, f), 'utf8');
    await writeFile(path.join(out, f), html.replace(/src="\.\.\/dist\/(?:popup|options)\/([^"]+)"/g, 'src="$1"'));
  }
}
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
// The repository root uses dist bundles; the distributable is self-contained.
const bundledPath = value => {
  if (!value.startsWith('dist/')) throw new Error('Root manifest must reference a built bundle: ' + value);
  return value.slice('dist/'.length);
};
manifest.background.service_worker = bundledPath(manifest.background.service_worker);
for (const content of manifest.content_scripts) content.js = content.js.map(bundledPath);
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await cp(path.join(root, 'lib/vendor/NOTICE.txt'), path.join(out, 'THIRD_PARTY_NOTICES.txt'));
await cp(path.join(root, 'lib/vendor/UNICODE-LICENSE.txt'), path.join(out, 'UNICODE-LICENSE.txt'));
await cp(path.join(root, 'node_modules/tldts/LICENSE'), path.join(out, 'TLDTS-LICENSE.txt'));
await cp(path.join(root, 'node_modules/punycode/LICENSE-MIT.txt'), path.join(out, 'PUNYCODE-LICENSE.txt'));
console.log('Built BlackFish: load blackfish or its self-contained dist folder as an unpacked extension.');
