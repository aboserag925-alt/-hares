'use strict';
const CATEGORIES=new Set(['feature','bug','design','content','performance','usability','other']);
const STATUSES=new Set(['NEW','ANALYZING','ANALYZED','PLANNED','WAITING_APPROVAL','APPROVED','REJECTED','IMPLEMENTING','TESTING','VERIFYING','READY_FOR_REVIEW','COMPLETED']);
function validateSuggestion(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) return {error:'بيانات الاقتراح غير صالحة.'};
  const allowed=new Set(['category','title','description']);
  if (Object.keys(input).some(key=>!allowed.has(key))) return {error:'توجد حقول غير معروفة.'};
  const category=String(input.category||'');
  const title=typeof input.title==='string'?input.title.trim():'';
  const description=typeof input.description==='string'?input.description.trim():'';
  if (!CATEGORIES.has(category)) return {error:'نوع الاقتراح غير صالح.'};
  if (title.length<4||title.length>120) return {error:'العنوان يجب أن يكون بين 4 و120 حرفًا.'};
  if (description.length<10||description.length>3000) return {error:'التفاصيل يجب أن تكون بين 10 و3000 حرف.'};
  return {value:{category,title,description}};
}
function validateAdminPatch(input) {
  if (!input||typeof input!=='object'||Array.isArray(input)) return {error:'التعديل غير صالح.'};
  const allowed=new Set(['status','priority','risk']);
  if (!Object.keys(input).length||Object.keys(input).some(key=>!allowed.has(key))) return {error:'حقول التعديل غير مسموحة.'};
  if (input.status!==undefined&&!STATUSES.has(input.status)) return {error:'الحالة غير صالحة.'};
  if (input.priority!==undefined&&!['low','normal','high','urgent'].includes(input.priority)) return {error:'الأولوية غير صالحة.'};
  if (input.risk!==undefined&&!['low','medium','high','critical'].includes(input.risk)) return {error:'درجة الخطورة غير صالحة.'};
  return {value:input};
}
module.exports={CATEGORIES,STATUSES,validateSuggestion,validateAdminPatch};
