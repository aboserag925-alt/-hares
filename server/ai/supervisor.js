'use strict';
const {assess}=require('./risk-engine');
const {route}=require('./router');
const {createTask,transition}=require('./task-store');
const {assertApproval}=require('./approval-gate');
class HaresAISupervisor {
  constructor(agents={}) { this.agents=agents; }
  async analyze(input) {
    const assessment=assess(input);
    let task=createTask(input,assessment);
    task=transition(task,'ANALYZED');
    const names=route(input.type||'suggestion');
    const reports=[];
    for (const name of names) {
      const agent=this.agents[name];
      if (!agent || typeof agent.run!=='function') {
        if (name==='security' || name==='verifier') {
          const report={agent:name,status:'BLOCKED',data:{blocked:true,reason:'Security agent unavailable'},warnings:['Required security review could not run']};
          reports.push(report);
          task={...task,tainted:true,status:'FAILED'};
          break;
        }
        continue;
      }
      let report;
      try {
        report=await agent.run({task:{...task},input});
      } catch (error) {
        if (name!=='security') throw error;
        report={agent:'security',status:'BLOCKED',data:{blocked:true,reason:'Security review failed'},warnings:['Required security review failed']};
      }
      reports.push(report);
      if (report && report.status==='BLOCKED') { task={...task,tainted:true,status:'FAILED'}; break; }
    }
    return Object.freeze({task,reports,plan:reports.filter(Boolean).map(x=>x.data||{})});
  }
  async implement(task,developer,input) {
    assertApproval(task,'implement');
    if (!developer || typeof developer.run!=='function') throw new Error('Developer agent unavailable');
    return developer.run({task,input});
  }
}
module.exports={HaresAISupervisor};
