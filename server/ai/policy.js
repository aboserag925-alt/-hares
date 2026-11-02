'use strict';
const HIGH_RISK_AREAS = new Set(['authentication','authorization','supabase_rls','admin_users','secrets','deployment','github_workflows','telegram_permissions','production_database']);
const TRANSITIONS = Object.freeze({
  PROPOSED:['ANALYZED','REJECTED','FAILED'],
  ANALYZED:['PLANNED','REJECTED','FAILED'],
  PLANNED:['WAITING_APPROVAL','REJECTED','FAILED'],
  WAITING_APPROVAL:['APPROVED','REJECTED'],
  APPROVED:['IMPLEMENTING','REJECTED'],
  IMPLEMENTING:['TESTING','FAILED'],
  TESTING:['VERIFYING','FAILED'],
  VERIFYING:['READY_FOR_REVIEW','FAILED'],
  READY_FOR_REVIEW:['HUMAN_APPROVED','FAILED'],
  HUMAN_APPROVED:['MERGED'],
  MERGED:[], FAILED:[], REJECTED:[]
});
function classifyRisk(areas=[], declared='low') {
  const normalized=Array.isArray(areas)?areas.map(x=>String(x).toLowerCase()):[];
  if (normalized.some(x=>['secrets','deployment','production_database'].includes(x))) return 'critical';
  if (normalized.some(x=>HIGH_RISK_AREAS.has(x))) return 'high';
  if (declared==='critical'||declared==='high') return declared;
  if (declared==='medium') return 'medium';
  return normalized.length ? 'medium' : 'low';
}
function requiresHumanApproval(risk) { return risk==='high'||risk==='critical'; }
function canTransition(from,to,task={}) {
  if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(to)) return false;
  if (to==='IMPLEMENTING' && !(task.approved===true && task.approvalId)) return false;
  if (to==='HUMAN_APPROVED' && !(task.humanApproved===true && task.humanApprovalId)) return false;
  if (to==='MERGED' && !(task.humanApproved===true && task.humanApprovalId)) return false;
  return true;
}
module.exports={HIGH_RISK_AREAS,TRANSITIONS,classifyRisk,requiresHumanApproval,canTransition};
