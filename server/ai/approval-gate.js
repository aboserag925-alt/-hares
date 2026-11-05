'use strict';
const {requiresHumanApproval}=require('./policy');
function assertApproval(task, action) {
  if (!task || task.tainted===true) throw new Error('AI task is missing or tainted');
  if (action==='implement' && task.approved!==true) throw new Error('Human approval is required before implementation');
  if (action==='implement' && !(task.approvalId||task.approval_id)) throw new Error('Recorded human approval is required');
  if (action==='merge' && !((task.humanApproved===true||task.human_approved===true) && (task.humanApprovalId||task.human_approval_id))) throw new Error('Explicit human merge approval is required');
  if (!['analyze','plan','implement','test','verify','merge'].includes(action)) throw new Error('Prohibited AI action');
  return true;
}
module.exports={assertApproval};
