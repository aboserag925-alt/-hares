'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {validateSuggestion,validateAdminPatch}=require('./suggestion-validator');
test('suggestion validator accepts only known fields',()=>{const r=validateSuggestion({category:'bug',title:'مشكلة في البحث',description:'البحث لا يعرض النتائج المطلوبة'});assert.equal(r.error,undefined);assert.equal(r.value.category,'bug');});
test('suggestion validator rejects unknown fields and oversized values',()=>{assert.ok(validateSuggestion({category:'bug',title:'عنوان صالح',description:'تفاصيل كافية هنا',status:'APPROVED'}).error);assert.ok(validateSuggestion({category:'bug',title:'x',description:'x'}).error);});
test('admin patch rejects attempts to set AI analysis or approval fields',()=>{assert.ok(validateAdminPatch({approved:true}).error);assert.ok(validateAdminPatch({ai_analysis:{ok:true}}).error);});
test('admin patch only accepts enumerated workflow values',()=>{assert.ok(validateAdminPatch({status:'MERGED'}).error);assert.ok(validateAdminPatch({risk:'critical'}).value);});
