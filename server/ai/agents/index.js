'use strict';
const {result}=require('../agent-result');
function createAgent(name,handler) {
  return Object.freeze({name,async run(context) {
    try { return result(name,'PASS',await handler(context)); }
    catch(error) { return result(name,'NEEDS_REVIEW',{},[String(error.message||'Agent failed').slice(0,240)]); }
  }});
}
const reportOnly=(name)=>createAgent(name,({task,input})=>({taskId:task.id||null,summary:'Analysis only; no direct repository writes.',inputType:input.type||'suggestion'}));
module.exports={createAgent,reportOnly};
