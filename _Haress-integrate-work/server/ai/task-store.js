'use strict';
const {canTransition}=require('./policy');
function transition(task,next,approval={}) {
  if (!task || !canTransition(task.status,next,{...task,...approval})) throw new Error('Invalid or unauthorized AI task transition');
  return {...task,...approval,status:next,updatedAt:new Date().toISOString()};
}
function createTask(input={},riskAssessment) {
  return {id:input.id,source:input.source||'suggestion',status:'PROPOSED',risk:riskAssessment.risk,confidence:null,requiresApproval:riskAssessment.requiresApproval,approved:false,tainted:false,affectedAreas:Array.isArray(input.affectedAreas)?input.affectedAreas:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
module.exports={transition,createTask};
