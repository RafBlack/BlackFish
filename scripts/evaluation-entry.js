import { bfAnalyzeUrl } from '../lib/heuristics/url-analysis.js';
import { bfCheckLookalikeDomain } from '../lib/heuristics/lookalike-domain.js';
import { bfAggregateScore } from '../lib/heuristics/score.js';
import { scanDom, scanAnchors } from '../content/dom-scanner.js';
import { submissionRisk } from '../content/form-guard.js';
import { BF_BRANDS } from '../lib/heuristics/brand-list.js';
export async function analyze(options = {}) {
  const start = performance.now();
  const url=bfAnalyzeUrl(location.href);
  const dom=scanDom(document,BF_BRANDS,options);
  const anchors=await scanAnchors(document,dom.collected);
  const scored=bfAggregateScore([url.signals,bfCheckLookalikeDomain(url.registrableDomain,url.hostname),...Object.values(dom.groups),anchors]);
  const interrupted=dom.collected.elements.filter(e=>e.localName==='form').some(f=>submissionRisk(f,null,BF_BRANDS,[],options).interrupt);
  return {score:scored.score,level:scored.level,interrupted,scanMs:performance.now()-start,signalIds:scored.signals.map(s=>s.id)};
}
