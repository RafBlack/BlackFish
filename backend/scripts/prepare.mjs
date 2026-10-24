import { readFile, writeFile } from 'node:fs/promises';
const id = process.argv[2];
if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id || '') || /^0+-0+-0+-0+-0+$/.test(id)) throw new Error('Pass the D1 database UUID created in your Cloudflare Free account.');
const config = JSON.parse(await readFile(new URL('../wrangler.json', import.meta.url), 'utf8'));
config.d1_databases[0].database_id = id;
await writeFile(new URL('../wrangler.local.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
console.log('Prepared ignored wrangler.local.json with managed AI disabled. Nothing was deployed.');
