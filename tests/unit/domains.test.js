import test from 'node:test';
import assert from 'node:assert/strict';
import { domainInfo, normalizeDomain, confusableSkeleton } from '../../lib/heuristics/domain.js';
import { bfAnalyzeUrl } from '../../lib/heuristics/url-analysis.js';
import { bfCheckLookalikeDomain } from '../../lib/heuristics/lookalike-domain.js';
import { bfSameBrandFamily, brandsWithCustom } from '../../lib/heuristics/brand-list.js';
test('private suffixes preserve distinct tenant boundaries', () => {
  assert.equal(domainInfo('victim.github.io').domain,'victim.github.io');
  assert.equal(domainInfo('attacker.github.io').domain,'attacker.github.io');
  assert.equal(domainInfo('login.example.co.uk').domain,'example.co.uk');
  assert.equal(domainInfo('127.0.0.1').domain,'127.0.0.1');
  assert.equal(domainInfo('[::1]').isIp,true);
});
test('ASCII and Unicode confusables including exact normalized matches are detected', () => {
  for (const host of ['paypa1.com',new URL('https://p\u0430ypal.com').hostname]) {
    assert.equal(bfCheckLookalikeDomain(host,host).some(s => s.id === 'homograph-domain'),true,host);
  }
  assert.equal(confusableSkeleton('paypa1.com'), confusableSkeleton('paypal.com'));
});
test('suffix changes are evaluated; approved siblings remain legitimate', () => {
  assert.equal(bfCheckLookalikeDomain('paypal.net','paypal.net').some(s => s.id === 'typosquat-domain'),true);
  assert.deepEqual(bfCheckLookalikeDomain('outlook.com','outlook.com'),[]);
  assert.equal(bfSameBrandFamily('outlook.com','office.com'),true);
  assert.equal(bfSameBrandFamily('outlook.com','office.com.evil.test'),false);
});
test('query strings and IDN encoding are not independent suspicion', () => {
  assert.equal(bfAnalyzeUrl('https://example.com/?email=alice@example.com&login=verify').signals.length,0);
  assert.equal(bfAnalyzeUrl('https://ma\u00f1ana.es').signals.length,0);
  assert.equal(bfAnalyzeUrl('https://user@example.com').signals.some(s => s.id === 'at-symbol-in-url'),true);
});
test('custom domains normalize safely, reject regex/markup/userinfo and preserve subdomains', () => {
  assert.equal(normalizeDomain('https://LOGIN.example.com/'),'login.example.com');
  for (const v of ['[abc.com','<b>example.com','a@b.com','example.com/path','example.com:123','*.example.com','example..com','co.uk','github.io']) assert.equal(normalizeDomain(v),null,v);
  assert.equal(brandsWithCustom(['[abc.com','acme.example']).some(b=>b.id === 'custom:acme.example'),true);
});
