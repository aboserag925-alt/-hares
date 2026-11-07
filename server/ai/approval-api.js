'use strict';
const MAX_BYTES=4096;
function send(res,status,payload){res.writeHead(status,{'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(payload));}
async function readBody(req){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>MAX_BYTES)throw Object.assign(new Error('Request too large'),{statusCode:413});chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{statusCode:400});}
}
function createApprovalApi({env,fetch:fetchImpl=global.fetch,taskService,rateLimit=()=>true}){
 async function authenticate(req){
  const match=(req.headers.authorization||'').match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
  if(!match||!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  const base=env.SUPABASE_URL.replace(/\/$/,'');
  const auth=await fetchImpl(base+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+match[1]},signal:AbortSignal.timeout(10000)});
  if(!auth.ok)return null;const user=await auth.json();if(!user?.id)return null;
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  const admin=await fetchImpl(base+'/rest/v1/admin_users?select=user_id&user_id=eq.'+encodeURIComponent(user.id)+'&limit=1',{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
  if(!admin.ok)return null;const rows=await admin.json();return rows.length?user:null;
 }
 return async function handle(req,res,path){
  const match=path.match(/^\/api\/admin\/ai\/tasks\/([0-9a-f-]{36})\/approval$/i);
  if(!match)return false;
  if(req.method!=='POST'){res.setHeader('Allow','POST');send(res,405,{error:'طريقة الطلب غير مدعومة.'});return true;}
  if(!rateLimit(req)){send(res,429,{error:'تجاوزت حد المحاولات. حاول لاحقًا.'});return true;}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){send(res,415,{error:'أرسل القرار بصيغة JSON.'});return true;}
  try{
   const user=await authenticate(req);if(!user){send(res,403,{error:'هذه العملية متاحة للمشرفين المصرح لهم فقط.'});return true;}
   const input=await readBody(req);
   const allowed=new Set(['action','decision','reason']);
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.has(k))||!['IMPLEMENT','MERGE'].includes(input.action)||!['APPROVED','REJECTED'].includes(input.decision)|| (input.reason!==undefined&&typeof input.reason!=='string')||(input.decision==='REJECTED'&&(!input.reason||!input.reason.trim()))){send(res,400,{error:'بيانات الموافقة غير صالحة.'});return true;}
   const approvalId=await taskService.recordHumanApproval({taskId:match[1],actorUserId:user.id,action:input.action,decision:input.decision,reason:input.reason||''});
   send(res,200,{approvalId});
  }catch(error){send(res,error.statusCode||409,{error:error.statusCode?error.message:'تعذر تسجيل القرار. تحقق من حالة المهمة وصلاحيات المشرف.'});}
  return true;
 };
}
module.exports={createApprovalApi};
