'use strict';
const ALLOWED_EVENTS=new Set(['suggestion.created','suggestion.updated','suggestion.rejected','ai.task.created','ai.analysis.completed','ai.approval.requested','ai.approval.granted','ai.approval.rejected','ai.implementation.started','ai.tests.executed','ai.verification.completed','ai.pull_request.prepared']);
const ALLOWED_META=new Set(['category','status','priority','risk','task_id','agent','result','affected_areas']);
function safeMetadata(value={}) {
  const result={};
  for(const [key,item] of Object.entries(value||{})) {
    if(!ALLOWED_META.has(key)) continue;
    if(typeof item==='string') result[key]=item.slice(0,160);
    else if(typeof item==='boolean'||typeof item==='number') result[key]=item;
    else if(Array.isArray(item)) result[key]=item.filter(x=>typeof x==='string').slice(0,20).map(x=>x.slice(0,80));
  }
  return result;
}
function createAuditLogger({env,fetch:fetchImpl=global.fetch}) {
  return Object.freeze({async record({event, suggestionId=null, actorUserId=null, metadata={}}) {
    if(!ALLOWED_EVENTS.has(event)) throw new Error('Unsupported audit event');
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Audit storage is not configured');
    const key=env.SUPABASE_SERVICE_ROLE_KEY;
    const response=await fetchImpl(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/ai_audit_events',{
      method:'POST',
      headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=minimal'},
      body:JSON.stringify({event_type:event,suggestion_id:suggestionId,actor_user_id:actorUserId,metadata:safeMetadata(metadata)}),
      signal:AbortSignal.timeout(10000)
    });
    if(!response.ok) throw new Error('Audit event could not be recorded');
  }});
}
module.exports={ALLOWED_EVENTS,safeMetadata,createAuditLogger};
