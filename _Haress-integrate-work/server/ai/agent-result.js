'use strict';
function result(agent,status,data={},issues=[]) {
  if (!/^[a-z-]+$/.test(agent)||!['PASS','FAIL','NEEDS_REVIEW','BLOCKED'].includes(status)) throw new TypeError('Invalid agent result');
  return Object.freeze({agent,status,data,issues:Array.isArray(issues)?issues:[],createdAt:new Date().toISOString()});
}
module.exports={result};
