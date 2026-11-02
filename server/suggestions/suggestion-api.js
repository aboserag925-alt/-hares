'use strict';
const {validateAdminPatch}=require('./suggestion-validator');
const MAX_BYTES=8192;
function send(res,status,payload){res.writeHead(status,{'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(payload));}
async function body(req) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_BYTES)throw Object.assign(new Error('Request too large'),{statusCode:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{statusCode:400});}
}
function createSuggestionsApi({env,fetch:fetchImpl=global.fetch,service,rateLimit=()=>true}) {
  async function admin(req) {
    const token=(req.headers.authorization||'').match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
    if(!token||!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
    const base=env.SUPABASE_URL.replace(/\/$/,'');
    const auth=await fetchImpl(base+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token[1]},signal:AbortSignal.timeout(10000)});
    if(!auth.ok)return null;const user=await auth.json();if(!user?.id)return null;
    const check=await fetchImpl(base+'/rest/v1/admin_users?select=user_id&user_id=eq.'+encodeURIComponent(user.id)+'&limit=1',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(10000)});
    if(!check.ok)return null;const rows=await check.json();return rows.length?user:null;
  }
  return async function handle(req,res,url) {
    const path=url.split('?')[0];
    if(path==='/api/suggestions') {
      if(req.method!=='POST'){res.setHeader('Allow','POST');send(res,405,{error:'طريقة الطلب غير مدعومة.'});return true;}
      if(!rateLimit(req)){send(res,429,{error:'تجاوزت حد إرسال الاقتراحات. حاول لاحقًا.'});return true;}
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){send(res,415,{error:'أرسل الاقتراح بصيغة JSON.'});return true;}
      try{const input=await body(req);const created=await service.submit(input,null);send(res,201,{item:created});}
      catch(e){send(res,e.statusCode||502,{error:e.statusCode?e.message:'تعذر حفظ الاقتراح الآن.'});}return true;
    }
    if(!path.startsWith('/api/admin/suggestions'))return false;
    if(!['GET','PATCH'].includes(req.method)){res.setHeader('Allow','GET, PATCH');send(res,405,{error:'طريقة الطلب غير مدعومة.'});return true;}
    try {
      const user=await admin(req);if(!user){send(res,403,{error:'هذه العملية متاحة للمشرفين المصرح لهم فقط.'});return true;}
      if(path==='/api/admin/suggestions'&&req.method==='GET'){send(res,200,{items:await service.list()});return true;}
      const match=path.match(/^\/api\/admin\/suggestions\/([0-9a-f-]{36})$/i);if(!match){send(res,404,{error:'الاقتراح غير موجود.'});return true;}
      if(req.method==='GET'){const item=await service.get(match[1]);send(res,item?200:404,item?{item}:{error:'الاقتراح غير موجود.'});return true;}
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){send(res,415,{error:'أرسل التعديل بصيغة JSON.'});return true;}
      const checked=validateAdminPatch(await body(req));if(checked.error){send(res,400,{error:checked.error});return true;}
      const item=await service.update(match[1],checked.value);send(res,item?200:404,item?{item}:{error:'الاقتراح غير موجود.'});return true;
    }catch(e){send(res,e.statusCode||502,{error:e.statusCode?e.message:'تعذر تنفيذ الطلب الآن.'});return true;}
  };
}
module.exports={createSuggestionsApi};
