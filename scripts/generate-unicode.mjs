import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const folder=new URL('../lib/vendor/',import.meta.url);
const source=await readFile(new URL('confusables-17.0.0.txt',folder),'utf8');
const expected='091c7f82fc39ef208faf8f94d29c244de99254675e09de163160c810d13ef22a';
const actual=createHash('sha256').update(source).digest('hex');
if(actual!==expected)throw new Error('Pinned Unicode source checksum mismatch.');
const map={};
for(const line of source.split('\n')){
  const clean=line.split('#')[0].trim();if(!clean)continue;
  const[from,to]=clean.split(';').map(s=>s.trim());
  const decode=value=>String.fromCodePoint(...value.split(/\s+/).map(hex=>parseInt(hex,16)));
  map[decode(from)]=decode(to);
}
await writeFile(new URL('confusables.js',folder),'// Generated from pinned Unicode 17.0.0 confusables.txt. Unicode License v3.\nexport const CONFUSABLES = Object.freeze('+JSON.stringify(map)+');\n');
await writeFile(new URL('confusables.sha256',folder),actual+'\n');
console.log('Generated '+Object.keys(map).length+' pinned Unicode mappings.');
