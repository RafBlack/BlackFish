const password = '<form id="login"><label>Password<input type="password" value="fixture-only"></label><button>Sign in</button></form>';
const cases = [
  { id:'heading', label:'phishing', body:'<section><h1>Microsoft</h1>'+password+'</section>' },
  { id:'legend', label:'phishing', body:password.replace('<label>','<fieldset><legend>PayPal</legend><label>').replace('</form>','</fieldset></form>') },
  { id:'accessible-name', label:'phishing', body:password.replace('id="login"','id="login" aria-label="Apple account"') },
  { id:'label-reference', label:'phishing', body:'<h2 id="identity">Google</h2>'+password.replace('id="login"','id="login" aria-labelledby="identity"') },
  { id:'otp', label:'phishing', body:'<section><h2>Office</h2>'+password.replace('type="password"','type="text" autocomplete="one-time-code"')+'</section>' },
  { id:'shadow', label:'phishing', body:'<section id="widget"></section><script>document.getElementById("widget").attachShadow({mode:"open"}).innerHTML='+JSON.stringify('<h2>Microsoft</h2>'+password)+';</script>' },
  { id:'repeated', label:'phishing', title:'PayPal', body:'<section><h1>PayPal</h1><img alt="PayPal"><h2>PayPal</h2>'+password+'</section>' },
  { id:'lookalike', label:'phishing', url:'https://paypa1.com/context', body:'<section><h1>PayPal</h1>'+password+'</section>' },
  { id:'ordinary-login', label:'benign', body:'<section><h1>Your account</h1>'+password+'</section>' },
  { id:'microsoft', label:'benign', url:'https://login.microsoftonline.com/context', body:'<section><h1>Microsoft</h1>'+password+'</section>' },
  { id:'brand-sibling', label:'benign', url:'https://login.office.com/context', body:'<section><h1>Microsoft</h1>'+password+'</section>' },
  { id:'stripe', label:'benign', url:'https://m.stripe.network/context', body:'<section><h1>Stripe</h1>'+password+'</section>' },
  { id:'enterprise-login', label:'benign', rationale:'Synthetic enterprise-owned federated login using Microsoft branding on its own origin; brand mismatch alone cannot establish malicious ownership.', body:'<section><h1>Microsoft</h1><p>Company sign-in</p>'+password+'</section>' },
  { id:'sso', label:'benign', body:'<section><h1>Google</h1>'+password.replace('<form ','<form action="https://identity.example.net/" ')+'</section>' },
  { id:'article', label:'benign', body:'<main><article><h1>Microsoft integration guide</h1></article><section><h2>Documentation account</h2>'+password+'</section></main>' },
  { id:'body-heading', label:'benign', body:'<h1>Google integration guide</h1>'+password },
  { id:'logo-only', label:'benign', body:'<section><img alt="Microsoft">'+password+'</section>' },
  { id:'hidden-heading', label:'benign', body:'<section><div style="opacity:0"><h1>Microsoft</h1></div>'+password+'</section>' },
  { id:'multiple-forms', label:'benign', body:'<section><h1>Microsoft integration guide</h1>'+password+password.replace('id="login"','id="other"')+'</section>' },
  { id:'text-only-http', label:'benign', body:'<form action="http://insecure.example.org/"><input type="text"><button>Submit</button></form>' },
  { id:'insecure-password', label:'transport', rationale:'An intentional insecure-password interruption, separate from benign-login false-positive measurements.', body:password.replace('<form ','<form action="http://insecure.example.org/" ') },
  { id:'simulation-info', label:'benign', body:'<h1>Feature settings check</h1><p>This is a harmless test page.</p>' },
  { id:'oversized-elements', label:'benign', body:'<section><h1>Microsoft integration guide</h1>'+'<span></span>'.repeat(100)+password+'</section>' },
  { id:'oversized-text', label:'benign', body:'<section><h1>Microsoft integration guide</h1><p>'+'x'.repeat(1001)+'</p>'+password+'</section>' }
];
export const FORM_BRANDING_CORPUS = {
  version:1, synthetic:true,
  description:'Targeted, hand-labeled synthetic regressions. Includes a deliberate enterprise-login counterexample. Not an independent accuracy benchmark or AI training data.',
  fixtures:cases.map(item=>({
    ...item, family:'form-context:'+item.id, split:'regression',
    url:item.url || 'https://'+item.id+'.form-context.example.org/',
    title:item.title || 'Sign in',
    html:'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'+(item.title || 'Sign in')+'</title></head><body>'+item.body+'</body></html>'
  }))
};
