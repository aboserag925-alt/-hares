'use strict';
const ROUTES=Object.freeze({
  product:['product'], suggestion:['suggestion','security'], security:['security'],
  implementation:['security','developer','test','verifier'], ux:['ux','security'],
  content:['content','security'], performance:['performance','security']
});
function route(type) {
  const selected=ROUTES[type];
  if (!selected) throw new Error('Unsupported AI task type');
  return [...selected];
}
module.exports={route};
