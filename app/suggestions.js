'use strict';
(function(){
  if(document.getElementById('haresSuggestionDialog'))return;
  const style=document.createElement('style');
  style.textContent='#haresSuggestionButton{position:fixed;z-index:30;left:18px;bottom:18px;border:1px solid #d5ab64;border-radius:999px;padding:12px 18px;background:#19201d;color:#f2d9a4;font:700 14px Cairo, sans-serif;box-shadow:0 8px 24px #0006}#haresSuggestionDialog{width:min(520px,calc(100% - 28px));max-height:85vh;overflow:auto;margin:auto;padding:22px;border:1px solid #d5ab64;border-radius:20px;background:#121715;color:#f4f0e7;font-family:Cairo,sans-serif}#haresSuggestionDialog::backdrop{background:#000b}#haresSuggestionDialog label{display:block;margin:12px 0 5px}#haresSuggestionDialog input,#haresSuggestionDialog textarea,#haresSuggestionDialog select{width:100%;padding:11px;border:1px solid #66543a;border-radius:10px;background:#0b0e0d;color:#f4f0e7;font:inherit}#haresSuggestionDialog textarea{min-height:120px}#haresSuggestionDialog button{margin:12px 6px 0 0;padding:10px 16px;border:1px solid #d5ab64;border-radius:12px;background:#21190f;color:#f2d9a4;font:700 14px Cairo,sans-serif}#haresSuggestionStatus{min-height:24px}';
  document.head.appendChild(style);
  const button=document.createElement('button');button.id='haresSuggestionButton';button.type='button';button.textContent='💡 اقتراح تطوير';
  const dialog=document.createElement('dialog');dialog.id='haresSuggestionDialog';dialog.dir='rtl';dialog.lang='ar';
  dialog.innerHTML='<form id="haresSuggestionForm"><h2>اقتراح تطوير المنصة</h2><label for="haresSuggestionCategory">نوع الاقتراح</label><select id="haresSuggestionCategory" required><option value="feature">ميزة جديدة</option><option value="bug">مشكلة</option><option value="design">تحسين تصميم</option><option value="content">محتوى</option><option value="performance">أداء</option><option value="usability">سهولة استخدام</option><option value="other">أخرى</option></select><label for="haresSuggestionTitle">عنوان الاقتراح</label><input id="haresSuggestionTitle" maxlength="120" minlength="4" required><label for="haresSuggestionDescription">تفاصيل الاقتراح</label><textarea id="haresSuggestionDescription" maxlength="3000" minlength="10" required></textarea><p id="haresSuggestionStatus" role="status" aria-live="polite"></p><button id="haresSuggestionSubmit" type="submit">إرسال الاقتراح</button><button id="haresSuggestionClose" type="button">إغلاق</button></form>';
  document.body.append(button,dialog);
  button.addEventListener('click',()=>dialog.showModal());
  dialog.querySelector('#haresSuggestionClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  dialog.querySelector('form').addEventListener('submit',async e=>{
    e.preventDefault();const submit=dialog.querySelector('#haresSuggestionSubmit');const status=dialog.querySelector('#haresSuggestionStatus');
    const payload={category:dialog.querySelector('#haresSuggestionCategory').value,title:dialog.querySelector('#haresSuggestionTitle').value.trim(),description:dialog.querySelector('#haresSuggestionDescription').value.trim()};
    submit.disabled=true;status.textContent='جارٍ إرسال الاقتراح…';
    try{const base=String(window.AHL_API_BASE_URL||'').replace(/\/+$/,'');const response=await fetch(base+'/api/suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'تعذر إرسال الاقتراح.');status.textContent='وصل اقتراحك، شكرًا لمساهمتك.';dialog.querySelector('form').reset();setTimeout(()=>dialog.close(),1300);}
    catch(error){status.textContent=error.message||'تعذر الاتصال بالخادم.';}
    finally{submit.disabled=false;}
  });
})();
