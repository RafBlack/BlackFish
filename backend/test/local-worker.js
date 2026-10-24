import worker from '../src/worker.js';
let calls = 0;
export default {
  async fetch(request, env) {
    if (!['127.0.0.1','localhost'].includes(new URL(request.url).hostname)) return new Response('Local fixture only.', { status: 403 });
    if (new URL(request.url).pathname === '/__test/stats') {
      const jobs = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM ai_jobs WHERE status='complete') AS count,(SELECT COUNT(*) FROM reports WHERE status='pending') AS backlog").first();
      return Response.json({ modelCalls: calls, completed: jobs.count, backlog: jobs.backlog });
    }
    return worker.fetch(request, { ...env, AI: { async run() { calls++; await new Promise(resolve => setTimeout(resolve,100)); return { response: '{"escalate":true,"reason":"Synthetic local fixture; not a real model prediction."}' }; } } });
  },
  scheduled: worker.scheduled
};
