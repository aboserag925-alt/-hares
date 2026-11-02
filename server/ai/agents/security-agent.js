'use strict';
const {result}=require('../agent-result');
module.exports=Object.freeze({name:'security',async run({input}) {
  const areas=input.affectedAreas||[];
  const blocked=areas.some(x=>['secrets_exposure','rls_disabled','auth_bypass'].includes(x));
  return result('security',blocked?'BLOCKED':'PASS',{blocked,reviewRequired:true,areas},blocked?['Prohibited security boundary detected']:[]);
}});
