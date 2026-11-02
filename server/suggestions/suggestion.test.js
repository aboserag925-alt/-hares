'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {validateSuggestion,validateAdminPatch}=require('./suggestion-validator');
test('suggestion validator accepts only known fields',()=>{const r=validateSuggestion({category:'bug',title:'مشكلة في البحث',description:'البحث لا يعرض النتائج المطلوبة'});assert.equal(r.error,undefined);assert.equal(r.value.category,'bug');});
test('suggestion validator rejects unknown fields and oversized values',()=>{assert.ok(validateSuggestion({category:'bug',title:'عنوان صالح',description:'تفاصيل كافية هنا',status:'APPROVED'}).error);assert.ok(validateSuggestion({category:'bug',title:'x',description:'x'}).error);});
test('admin patch rejects attempts to set AI analysis or approval fields',()=>{assert.ok(validateAdminPatch({approved:true}).error);assert.ok(validateAdminPatch({ai_analysis:{ok:true}}).error);});
test('admin patch only accepts enumerated workflow values',()=>{assert.ok(validateAdminPatch({status:'MERGED'}).error);assert.ok(validateAdminPatch({risk:'critical'}).value);});

test('generic admin patch cannot approve, change risk, or start implementation',()=>{assert.ok(validateAdminPatch({status:'APPROVED'}).error);assert.ok(validateAdminPatch({status:'IMPLEMENTING'}).error);assert.ok(validateAdminPatch({status:'COMPLETED'}).error);});

const {Readable}=require('node:stream');
const {createSuggestionsApi}=require('./suggestion-api');
function fakeResponse(){
 return {status:null,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers||{});},end(body){this.body=body||'';}};
}
function fakeRequest(method,headers={},payload){
 const req=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);
 req.method=method;req.headers=headers;return req;
}
test('public suggestions API rejects unknown fields before storage',async()=>{
 let submitted=false;
 const api=createSuggestionsApi({env:{},service:{submit:async()=>{submitted=true;}},rateLimit:()=>true});
 const res=fakeResponse();
 await api(fakeRequest('POST',{'content-type':'application/json'},{category:'bug',title:'عنوان صالح',description:'تفاصيل كافية للاقتراح',status:'APPROVED'}),res,'/api/suggestions');
 assert.equal(res.status,400);assert.equal(submitted,false);
});
test('admin suggestions API denies requests without a verified administrator',async()=>{
 let listed=false;
 const api=createSuggestionsApi({env:{SUPABASE_URL:'https://project.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'},fetch:async()=>({ok:false}),service:{list:async()=>{listed=true;return[];}}});
 const res=fakeResponse();
 await api(fakeRequest('GET',{}),res,'/api/admin/suggestions');
 assert.equal(res.status,403);assert.equal(listed,false);
});
test('admin suggestions API checks Supabase identity and admin_users before listing',async()=>{
 const calls=[];
 const api=createSuggestionsApi({
  env:{SUPABASE_URL:'https://project.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'},
  fetch:async(url,options)=>{calls.push({url,options});return url.endsWith('/auth/v1/user')?{ok:true,json:async()=>({id:'admin-user-id'})}:{ok:true,json:async()=>[{user_id:'admin-user-id'}]};},
  service:{list:async()=>[{id:'suggestion-1'}]}
 });
 const res=fakeResponse();
 await api(fakeRequest('GET',{authorization:'Bearer valid.token.value'}),res,'/api/admin/suggestions');
 assert.equal(res.status,200);assert.equal(JSON.parse(res.body).items[0].id,'suggestion-1');
 assert.equal(calls.length,2);assert.match(calls[1].url,/admin_users/);
});
