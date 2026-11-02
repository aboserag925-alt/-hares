'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {Readable}=require('node:stream');
const {createApprovalApi}=require('./approval-api');
function response(){return{status:null,headers:{},body:'',setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h||{});},end(v){this.body=v||'';}};}
function request(method,headers={},body){const r=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);r.method=method;r.headers=headers;return r;}
test('AI approval endpoint rejects non-admin users',async()=>{
 const api=createApprovalApi({env:{SUPABASE_URL:'https://project.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'},fetch:async()=>({ok:false}),taskService:{recordHumanApproval:async()=>{throw Error('must not be called');}}});
 const res=response();await api(request('POST',{'content-type':'application/json'},{action:'IMPLEMENT',decision:'APPROVED'}),res,'/api/admin/ai/tasks/123e4567-e89b-42d3-a456-426614174000/approval');assert.equal(res.status,403);
});
test('AI approval endpoint derives approver from Supabase identity and calls trusted task service',async()=>{
 let approvalArgs;
 const api=createApprovalApi({env:{SUPABASE_URL:'https://project.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'},fetch:async url=>url.endsWith('/auth/v1/user')?{ok:true,json:async()=>({id:'admin-1'})}:{ok:true,json:async()=>[{user_id:'admin-1'}]},taskService:{recordHumanApproval:async args=>{approvalArgs=args;return'db-approval-1';}}});
 const res=response();await api(request('POST',{authorization:'Bearer good.token.value','content-type':'application/json'},{action:'IMPLEMENT',decision:'APPROVED',reason:'موافقة بشرية'}),res,'/api/admin/ai/tasks/123e4567-e89b-42d3-a456-426614174000/approval');
 assert.equal(res.status,200);assert.equal(approvalArgs.actorUserId,'admin-1');assert.equal(JSON.parse(res.body).approvalId,'db-approval-1');
});
test('AI approval endpoint rejects client attempts to supply actor or approval flags',async()=>{
 const api=createApprovalApi({env:{SUPABASE_URL:'https://project.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'},fetch:async url=>url.endsWith('/auth/v1/user')?{ok:true,json:async()=>({id:'admin-1'})}:{ok:true,json:async()=>[{user_id:'admin-1'}]},taskService:{recordHumanApproval:async()=>{throw Error('must not be called');}}});
 const res=response();await api(request('POST',{authorization:'Bearer good.token.value','content-type':'application/json'},{action:'IMPLEMENT',decision:'APPROVED',actorUserId:'attacker',approved:true}),res,'/api/admin/ai/tasks/123e4567-e89b-42d3-a456-426614174000/approval');assert.equal(res.status,400);
});
