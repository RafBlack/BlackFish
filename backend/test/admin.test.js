import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { digest } from '../../lib/cloud-contract.js';

test('offline administrator CLI issues hashed invitations and explicitly reviews/revokes a report',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'blackfish-admin-fixture-')),databasePath=path.join(folder,'review.sqlite');
  const script=fileURLToPath(new URL('../scripts/admin.mjs',import.meta.url));
  const run=(...args)=>{const result=spawnSync(process.execPath,[script,...args,'--local',databasePath],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
  assert.equal(run('init-local').initialized,true);
  const invite=run('invite');assert.match(invite.invitationToken,/^[a-f0-9]{64}$/);
  const db=new DatabaseSync(databasePath);
  try{
    const installation=db.prepare('SELECT * FROM installations').get();assert.equal(installation.token_hash,await digest(invite.invitationToken));assert.notEqual(installation.token_hash,invite.invitationToken);
    const url='https://reviewed.example.com/login?campaign=fixture';
    db.prepare("INSERT INTO reports(id,installation,request_id,url,url_hash,hostname,features,reuse_consent,created_at) VALUES('fixture-report',?,'fixture-report-id',?,?,'reviewed.example.com','{}',1,?)").run(installation.id,url,await digest(url),Date.now());
    const reviewed=run('confirm','fixture-report','url','fixture-reviewer','Independent synthetic CLI test evidence.');
    assert.equal(reviewed.scope,'url');assert.equal(db.prepare("SELECT status FROM reports WHERE id='fixture-report'").get().status,'confirmed');
    assert.equal(db.prepare('SELECT scope FROM threats WHERE id=?').get(reviewed.threatId).scope,'url');
    run('revoke-threat',reviewed.threatId);assert.equal(db.prepare('SELECT revoked FROM threats WHERE id=?').get(reviewed.threatId).revoked,1);
    run('revoke-installation',invite.installationId);assert.equal(db.prepare('SELECT active FROM installations').get().active,0);
  }finally{db.close();}
});
