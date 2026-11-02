'use strict';
const {requiresHumanApproval}=require('./policy');
function assertApproval(task, action) {
  if (!task || task.tainted===true) throw new Error('AI task is missing or tainted');
  if (action==='implement' && task.approved!==true) throw new Error('Human approval is required before implementation');
  if (action==='implement' && requiresHumanApproval(task.risk) && !task.approvalId) throw new Error('Recorded human approval is required');
  if (action==='merge' && !(task.humanApproved===true && task.humanApprovalId)) throw new Error('Explicit human merge approval is required');
  if (!['analyze','plan','implement','test','verify','merge'].includes(action)) throw new Error('Prohibited AI action');
  return true;
}
module.exports={assertApproval};
