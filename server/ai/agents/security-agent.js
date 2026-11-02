'use strict';
const {result}=require('../agent-result');
module.exports=Object.freeze({name:'security',async run({input}) {
  const areas=Array.isArray(input.affectedAreas)
    ? input.affectedAreas.map(function (area) { return String(area).trim().toLowerCase(); })
    : [];
  const blocked=areas.some(x=>['secrets_exposure','rls_disabled','auth_bypass'].includes(x));
  return result('security',blocked?'BLOCKED':'PASS',{blocked,reviewRequired:true,areas},blocked?['Prohibited security boundary detected']:[]);
}});
