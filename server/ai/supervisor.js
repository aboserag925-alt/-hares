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
    const requiredAgents=new Set(['security']);
    if(input.type==='implementation') requiredAgents.add('verifier');
    const missingRequired=names.find(name=>
      requiredAgents.has(name)&&
      (!this.agents[name]||typeof this.agents[name].run!=='function')
    );
    if(missingRequired){
      const report={
        agent:missingRequired,
        status:'BLOCKED',
        data:{blocked:true,reason:missingRequired==='security'?'Security agent unavailable':'Verifier agent unavailable'},
        warnings:[`Required ${missingRequired} review could not run`]
      };
      return Object.freeze({
        task:{...task,tainted:true,status:'FAILED'},
        reports:[report],
        plan:[report.data]
      });
    }
    for (const name of names) {
      // The developer agent is invoked only by implement(), after the approval gate.
      if (name==='developer') continue;
      const agent=this.agents[name];
      if (!agent || typeof agent.run!=='function') {
        continue;
      }
      let report;
      try {
        report=await agent.run({task:{...task},input});
      } catch (error) {
        if (!requiredAgents.has(name)) throw error;
        report={agent:name,status:'BLOCKED',data:{blocked:true,reason:`${name} review failed`},warnings:[`Required ${name} review failed`]};
      }
      reports.push(report);
      if (!report||report.status==='BLOCKED'||report.status==='FAIL'||report.status==='FAILED'||
          (requiredAgents.has(name)&&report.status!=='PASS')) {
        task={...task,tainted:true,status:'FAILED'};
        break;
      }
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
