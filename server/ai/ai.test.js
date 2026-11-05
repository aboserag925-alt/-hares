'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {classifyRisk,canTransition}=require('./policy');
const {assess}=require('./risk-engine');
const {assertApproval}=require('./approval-gate');
const {route}=require('./router');
const {HaresAISupervisor}=require('./supervisor');
test('high-risk areas always require human approval',()=>{const a=assess({affectedAreas:['supabase_rls']});assert.equal(a.risk,'high');assert.equal(a.requiresApproval,true);});
test('production secrets and deployment are critical',()=>{assert.equal(classifyRisk(['secrets']),'critical');assert.equal(classifyRisk(['deployment']),'critical');});
test('approval gate blocks unapproved developer work',()=>{assert.throws(()=>assertApproval({approved:false},'implement'),/Human approval/);});
test('approval gate requires a recorded approval id',()=>{assert.throws(()=>assertApproval({approved:true,risk:'high'},'implement'),/Recorded human approval/);assert.equal(assertApproval({approved:true,approvalId:'human-approval-1',risk:'high'},'implement'),true);});
test('state machine blocks WAITING_APPROVAL to IMPLEMENTING',()=>{assert.equal(canTransition('WAITING_APPROVAL','IMPLEMENTING',{approved:true,approvalId:'x'}),false);});
test('state machine blocks READY_FOR_REVIEW to MERGED without human approval',()=>{assert.equal(canTransition('READY_FOR_REVIEW','MERGED',{}),false);assert.equal(canTransition('HUMAN_APPROVED','MERGED',{humanApproved:true,humanApprovalId:'x'}),true);});
test('agent router rejects unknown task categories',()=>{assert.deepEqual(route('implementation'),['security','developer','test','verifier']);assert.throws(()=>route('shell'),/Unsupported/);});
test('security agent blocks prohibited auth/RLS bypass signals case-insensitively',async()=>{const security=require('./agents/security-agent');const r=await security.run({input:{affectedAreas:['AUTH_BYPASS']}});assert.equal(r.status,'BLOCKED');});
test('security agent safely handles malformed affected areas',async()=>{const security=require('./agents/security-agent');const r=await security.run({input:{affectedAreas:'auth_bypass'}});assert.equal(r.status,'BLOCKED');});
test('supervisor stops when security agent blocks a task',async()=>{const security=require('./agents/security-agent');const supervisor=new HaresAISupervisor({security});const r=await supervisor.analyze({id:'task-1',type:'security',affectedAreas:['rls_disabled']});assert.equal(r.task.status,'FAILED');assert.equal(r.task.tainted,true);});
test('supervisor fails closed when a required security agent is missing',async()=>{const supervisor=new HaresAISupervisor({});const r=await supervisor.analyze({id:'task-2',type:'implementation'});assert.equal(r.task.status,'FAILED');assert.equal(r.task.tainted,true);assert.equal(r.reports[0].status,'BLOCKED');});
test('supervisor fails closed when required security review throws',async()=>{const supervisor=new HaresAISupervisor({security:{run:async()=>{throw Error('review unavailable')}}});const r=await supervisor.analyze({id:'task-3',type:'security'});assert.equal(r.task.status,'FAILED');assert.equal(r.task.tainted,true);});

test('database approval fields are accepted only when backed by approval IDs',()=>{
 assert.equal(canTransition('WAITING_APPROVAL','APPROVED',{approved:true}),false);
 assert.equal(canTransition('WAITING_APPROVAL','APPROVED',{approved:true,approval_id:'db-approval'}),true);
 assert.equal(canTransition('READY_FOR_REVIEW','HUMAN_APPROVED',{human_approved:true,human_approval_id:'db-merge-approval'}),true);
});
test('approval gate accepts persisted snake-case approval records',()=>{
 assert.equal(assertApproval({approved:true,approval_id:'db-approval',risk:'critical'},'implement'),true);
 assert.equal(assertApproval({human_approved:true,human_approval_id:'db-merge-approval'},'merge'),true);
});

test('supervisor fails closed when required verifier agent is missing',async()=>{const pass={run:async()=>({status:'PASS',data:{}})};const supervisor=new HaresAISupervisor({security:pass,developer:pass,test:pass});const r=await supervisor.analyze({id:'task-verifier-missing',type:'implementation'});assert.equal(r.task.status,'FAILED');assert.equal(r.task.tainted,true);assert.equal(r.reports.at(-1).agent,'verifier');assert.equal(r.reports.at(-1).status,'BLOCKED');});
