'use strict';
const {result}=require('../agent-result');
module.exports=Object.freeze({name:'security',async run({input}) {
  const validAreas=input.affectedAreas===undefined || Array.isArray(input.affectedAreas);
  const areas=Array.isArray(input.affectedAreas)
    ? input.affectedAreas.map(function (area) { return String(area).trim().toLowerCase(); })
    : [];
  const text=[input.title,input.description,input.content].filter(function(value){return typeof value==='string';}).join('\\n').slice(0,6000);
  const injectionPatterns=[
    /\\b(ignore|disregard)\\s+(all\\s+)?(previous|prior|above)\\s+instructions\\b/i,
    /\\b(reveal|print|expose|exfiltrate)\\s+(the\\s+)?(system prompt|secret|api key|token)\\b/i,
    /\\b(disable|turn off)\\s+(rls|row level security|authentication|authorization)\\b/i,
    /\\b(bypass|override)\\s+(auth|authorization|approval|rls)\\b/i
  ];
  const promptInjection=injectionPatterns.some(function(pattern){return pattern.test(text);});
  const secretExposure=/\\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\\b/.test(text);
  const blocked=!validAreas || areas.some(x=>['secrets_exposure','rls_disabled','auth_bypass','prompt_injection','data_exfiltration'].includes(x)) || promptInjection || secretExposure;
  const flags={promptInjection,secretExposure};
  return result('security',blocked?'BLOCKED':'PASS',{blocked,reviewRequired:true,areas,flags,tainted:true},blocked?['Untrusted or prohibited input detected']:[]);
}});
