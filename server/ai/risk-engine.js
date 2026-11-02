'use strict';
const {classifyRisk,requiresHumanApproval}=require('./policy');
function assess(task={}) {
  const affectedAreas=Array.isArray(task.affectedAreas)?task.affectedAreas:[];
  const risk=classifyRisk(affectedAreas,task.risk);
  return Object.freeze({risk,requiresApproval:requiresHumanApproval(risk),reasons:affectedAreas.filter(x=>['authentication','authorization','supabase_rls','admin_users','secrets','deployment','github_workflows','telegram_permissions','production_database'].includes(String(x).toLowerCase()))});
}
module.exports={assess};
