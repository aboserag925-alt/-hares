'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTaskService}=require('./task-service');

test('persisted AI tasks are tainted by default and trusted only by explicit internal opt-in',async()=>{
 const calls=[];
 const fetch=async(url,options)=>{
  calls.push({url:String(url),options:options||{}});
  if(String(url).includes('/rest/v1/ai_tasks?')){
   const body=JSON.parse(options.body);
   return {ok:true,status:201,json:async()=>[{id:'task-1',suggestion_id:body.suggestion_id,risk:body.risk,affected_areas:body.affected_areas}]};
  }
  return {ok:true,status:201,json:async()=>[]};
 };
 const service=createTaskService({env:{SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:'server-only'},fetch});
 await service.create({source:'suggestion',affectedAreas:['supabase_rls']});
 await service.create({source:'internal',trustedSource:true,affectedAreas:['content']});
 const taskBodies=calls.filter(call=>call.url.includes('/rest/v1/ai_tasks?')).map(call=>JSON.parse(call.options.body));
 assert.equal(taskBodies.length,2);
 assert.equal(taskBodies[0].tainted,true);
 assert.equal(taskBodies[1].tainted,false);
 assert.equal(taskBodies[0].requires_approval,true);
 assert.ok(!JSON.stringify(taskBodies).includes('server-only'));
});

test('AI task service refuses rejected decisions without a reason',async()=>{
 const service=createTaskService({env:{SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:'server-only'},fetch:async()=>{throw Error('must not call storage');}});
 await assert.rejects(service.recordHumanApproval({
  taskId:'123e4567-e89b-42d3-a456-426614174000',
  actorUserId:'123e4567-e89b-42d3-a456-426614174001',
  action:'IMPLEMENT',
  decision:'REJECTED',
  reason:''
 }),/Invalid approval request/);
});
