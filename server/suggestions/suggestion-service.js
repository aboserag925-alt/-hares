'use strict';
const {validateSuggestion}=require('./suggestion-validator');
const {createAuditLogger}=require('../ai/audit-log');
function createSuggestionService({env,fetch:fetchImpl=global.fetch}) {
  const audit=createAuditLogger({env,fetch:fetchImpl});
  async function request(path,init={}) {
    if (!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Suggestions storage is not configured');
    const response=await fetchImpl(env.SUPABASE_URL.replace(/\/$/,'')+path,{...init,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',...(init.headers||{})},signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new Error('Suggestions storage request failed');
    return response.status===204?null:response.json();
  }
  return Object.freeze({
    async submit(input,userId=null) {
      const checked=validateSuggestion(input); if(checked.error) throw Object.assign(new Error(checked.error),{statusCode:400});
      const rows=await request('/rest/v1/suggestions?select=id,category,title,description,status,created_at',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({...checked.value,user_id:userId})});
      try { await audit.record({event:'suggestion.created',suggestionId:rows[0].id,metadata:{category:checked.value.category,status:rows[0].status}}); } catch { console.error('Suggestion audit event could not be recorded'); }
      return rows[0];
    },
    async list() { return request('/rest/v1/suggestions?select=*&order=created_at.desc&limit=200'); },
    async get(id) { const rows=await request('/rest/v1/suggestions?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1'); return rows[0]||null; },
    async recordAnalysis(id, analysis, risk) {
      const rows=await request('/rest/v1/suggestions?id=eq.'+encodeURIComponent(id)+'&select=*',{
        method:'PATCH',
        headers:{Prefer:'return=representation'},
        body:JSON.stringify({status:'ANALYZED',risk:risk,ai_analysis:analysis,updated_at:new Date().toISOString()})
      });
      return rows[0]||null;
    },
    async update(id,patch,actorUserId=null) { const rows=await request('/rest/v1/suggestions?id=eq.'+encodeURIComponent(id)+'&select=*',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...patch,updated_at:new Date().toISOString()})}); const item=rows[0]||null; if(item) { try { await audit.record({event:patch.status==='REJECTED'?'suggestion.rejected':'suggestion.updated',suggestionId:item.id,actorUserId,metadata:{status:item.status,priority:item.priority,risk:item.risk}}); } catch { console.error('Suggestion audit event could not be recorded'); } } return item; }
  });
}
module.exports={createSuggestionService};
