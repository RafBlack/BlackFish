import { mkdir, writeFile } from 'node:fs/promises';
const password = '<form id="login"><label>Password<input type="password" name="password"><button>Sign in</button></label></form>';
const otp = '<form><label>Verification code<input autocomplete="one-time-code" name="otp"><button>Verify</button></label></form>';
const families = [
  ['article','benign','tuning',i=>['https://docs-'+i+'.example.org/','How to configure Google login','<article>Documentation for integrating Google authentication.</article>']],
  ['corporate-login','benign','tuning',i=>['https://workplace-'+i+'.example.net/','Employee portal',password]],
  ['cross-site-sso','benign','tuning',i=>['https://portal-'+i+'.example.com/','Company sign in',password.replace('<form id="login">','<form id="login" action="https://identity.example.net/login">')]],
  ['international-site','benign','tuning',i=>['https://ma\u00f1ana-'+i+'.example/','Bienvenido','<p>International-language community site.</p>']],
  ['analytics-hidden-fields','benign','tuning',i=>['https://member-'+i+'.example/','Member login',password.replace('</form>','<input type="hidden"><input type="hidden"><input type="hidden"><input type="hidden"><input type="hidden"></form>')+'<iframe style="display:none" src="https://analytics.example/"></iframe>']],
  ['brand-news','benign','evaluation',i=>['https://news-'+i+'.example.edu/','PayPal and Microsoft announce updates','<article>Reporting about technology companies.</article>']],
  ['software-download','benign','evaluation',i=>['https://downloads-'+i+'.example.info/','Developer downloads','<a href="/installer.exe">Download installer</a><a href="/tool.js">Download JavaScript tool</a>']],
  ['shadow-login','benign','evaluation',i=>['https://workspace-'+i+'.example.dev/','Team workspace','<section id="widget"></section><script>document.getElementById("widget").attachShadow({mode:"open"}).innerHTML='+JSON.stringify(password)+';</script>']],
  ['otp-login','benign','evaluation',i=>['https://authenticate-'+i+'.example.app/','Your verification code',otp]],
  ['approved-brand-family','benign','evaluation',i=>['https://tenant-'+i+'.outlook.com/','Outlook',password.replace('<form id="login">','<form id="login" action="https://office.com/login">')]],
  ['ascii-confusable','phishing','tuning',i=>['https://paypa1.fixture'+i+'/','PayPal sign in',password]],
  ['edit-distance','phishing','tuning',i=>['https://microsfot.fixture'+i+'/','Microsoft account',password]],
  ['brand-subdomain','phishing','tuning',i=>['https://paypal.collector-'+i+'.test/','PayPal account',password]],
  ['unicode-otp','phishing','evaluation',i=>['https://p\u0430ypal.holdout'+i+'/','PayPal verification',otp]],
  ['unrelated-brand-claim','phishing','evaluation',i=>['https://access-center-'+i+'.test/','PayPal sign in',password+'<p>Urgent: verify your account within 24 hours or access will be suspended.</p>']]
];
const fixtures=[];
for(const [family,label,split,make] of families)for(let i=0;i<20;i++){
  const [url,title,body]=make(i);
  fixtures.push({id:family+'-'+String(i).padStart(2,'0'),family,label,split,url:new URL(url).href,title,html:'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'+title+'</title></head><body>'+body+'</body></html>'});
}
const directory=new URL('../evaluation/',import.meta.url);await mkdir(directory,{recursive:true});
await writeFile(new URL('corpus.json',directory),JSON.stringify({version:1,synthetic:true,description:'Hand-labeled synthetic scenario families with deterministic parameter variants. Not a representative real-world phishing dataset. Labels reflect intended page behavior, not the detector output.',fixtures},null,2)+'\n');
console.log('Wrote 200 benign and 100 phishing fixtures across disjoint tuning/evaluation families.');
