import { readFile,writeFile } from 'node:fs/promises';
const folder=new URL('../evaluation/',import.meta.url);
const corpus=JSON.parse(await readFile(new URL('corpus.json',folder),'utf8'));
const report=JSON.parse(await readFile(new URL('latest-report.json',folder),'utf8'));
const results=new Map(report.results.map(r=>[r.id,r]));
// Offline synthetic text only. No provider calls, user pages, or API keys.
const inputs=corpus.fixtures.filter(f=>f.split==='evaluation').map(f=>({
  id:f.id,synthetic:true,context:{
    hostname:new URL(f.url).hostname,signalIds:results.get(f.id).signalIds,
    claimedTitle:f.title.slice(0,100),
    loginCues:f.html.replace(/<script>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,500)
  }
}));
await writeFile(new URL('ai-inputs.jsonl',folder),inputs.map(x=>JSON.stringify(x)).join('\n')+'\n');
console.log('Exported '+inputs.length+' synthetic, held-out AI inputs. Supply reviewed responses with npm run evaluate -- --ai-results PATH.');
