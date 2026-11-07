'use strict';
const {assess}=require('./risk-engine');
const {createAuditLogger}=require('./audit-log');
function createTaskService({env,fetch:fetchImpl=global.fetch}) {
  const audit=createAuditLogger({env,fetch:fetchImpl});
  async function request(path,init={}) {
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('AI task storage is not configured');
    const key=env.SUPABASE_SERVICE_ROLE_KEY;
    const response=await fetchImpl(env.SUPABASE_URL.replace(/\/$/,'')+path,{...init,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(init.headers||{})},signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new Error('AI task storage request failed');
    return response.status===204?null:response.json();
  }
  return Object.freeze({
    async create(input={}) {
      const risk=assess({affectedAreas:Array.isArray(input.affectedAreas)?input.affectedAreas:[]});
      const rows=await request('/rest/v1/ai_tasks?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
        suggestion_id:input.suggestionId||null,status:'PROPOSED',risk:risk.risk,confidence:null,
        requires_approval:risk.requiresApproval,approved:false,tainted:input.trustedSource!==true,
        source:input.source==='suggestion'?'suggestion':'internal',
        affected_areas:Array.isArray(input.affectedAreas)?input.affectedAreas.filter(x=>typeof x==='string').map(x=>x.trim().toLowerCase().slice(0,80)).filter(Boolean).slice(0,30):[]
      })});
      const task=rows[0];
      try{await audit.record({event:'ai.task.created',suggestionId:task.suggestion_id,metadata:{task_id:task.id,risk:task.risk,affected_areas:task.affected_areas}});}catch{console.error('AI task audit event could not be recorded');}
      return task;
    },
    async get(id) {
      const rows=await request('/rest/v1/ai_tasks?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');
      return rows[0]||null;
    },
    async findBySuggestion(suggestionId) {
      const rows=await request('/rest/v1/ai_tasks?suggestion_id=eq.'+encodeURIComponent(suggestionId)+'&select=*&order=created_at.desc&limit=1');
      return rows[0]||null;
    },
    async recordAnalysis(taskId, analysis) {
      const reports=Array.isArray(analysis.reports)?analysis.reports.slice(0,20):[];
      const models=analysis.models&&typeof analysis.models==='object'?analysis.models:{};
      for(const report of reports) {
        const result=['PASS','FAIL','NEEDS_REVIEW','BLOCKED'].includes(report.status)?report.status:'NEEDS_REVIEW';
        const body={task_id:taskId,agent:String(report.agent||'unknown').slice(0,80),result,report:{data:report.data||{},warnings:Array.isArray(report.warnings)?report.warnings.slice(0,10):[]}};
        await request('/rest/v1/ai_reviews',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      }
      for(const [name,value] of Object.entries(models).slice(0,2)) {
        const body={task_id:taskId,agent:String(name).slice(0,80),result:'NEEDS_REVIEW',report:{analysis:value.analysis||{},text:String(value.text||'').slice(0,4000)}};
        await request('/rest/v1/ai_reviews',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      }
      const status=analysis.task&&analysis.task.status==='FAILED'?'FAILED':'ANALYZED';
      await request('/rest/v1/ai_tasks?id=eq.'+encodeURIComponent(taskId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status,updated_at:new Date().toISOString()})});
      try{await audit.record({event:'ai.analysis.completed',metadata:{task_id:taskId,status,agent_reports:reports.length,model_reports:Object.keys(models).length,tainted:true}});}catch{console.error('AI analysis audit event could not be recorded');}
      return {status};
    },
    async recordHumanApproval({taskId,actorUserId,action,decision,reason=''}) {
      const validRejectionReason=decision!=='REJECTED'||(typeof reason==='string'&&reason.trim().length>0);
      if(!taskId||!actorUserId||!['IMPLEMENT','MERGE'].includes(action)||!['APPROVED','REJECTED'].includes(decision)||!validRejectionReason) throw new TypeError('Invalid approval request');
      const rows=await request('/rest/v1/rpc/record_ai_approval',{method:'POST',body:JSON.stringify({p_task_id:taskId,p_actor_user_id:actorUserId,p_action:action,p_decision:decision,p_reason:String(reason).slice(0,1000)})});
      return rows;
    }
  });
}
module.exports={createTaskService};
