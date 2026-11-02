'use strict';
(function(){
  const panel=document.getElementById('adminPanel');if(!panel||document.getElementById('haresSuggestionsAdmin'))return;
  const section=document.createElement('section');section.id='haresSuggestionsAdmin';section.className='panel';section.dir='rtl';section.innerHTML='<h2>لوحة تطوير المنصة بالذكاء الاصطناعي</h2><p>اقتراحات المستخدمين — عرض إداري للقراءة فقط في هذه المرحلة.</p><button type="button" id="haresLoadSuggestions">تحميل الاقتراحات</button><div id="haresSuggestionsList" aria-live="polite"></div>';
  const anchor=document.getElementById('listPanel');if(anchor)anchor.after(section);else panel.after(section);
  section.querySelector('button').addEventListener('click',async()=>{
    const target=section.querySelector('#haresSuggestionsList');target.textContent='جارٍ التحميل…';
    try{const token=await window.ahlAuth.getAccessToken();const base=String(window.AHL_API_BASE_URL||'').replace(/\/+$/,'');const response=await fetch(base+'/api/admin/suggestions',{headers:{Authorization:'Bearer '+token}});const data=await response.json();if(!response.ok)throw Error(data.error||'تعذر تحميل الاقتراحات');target.textContent='';(data.items||[]).forEach(item=>{const article=document.createElement('article');article.className='item';const title=document.createElement('h3');title.textContent=item.title;const details=document.createElement('p');details.textContent=item.description;const meta=document.createElement('p');meta.textContent='التصنيف: '+item.category+' · الحالة: '+item.status+' · الأولوية: '+item.priority+' · الخطورة: '+item.risk;article.append(title,details,meta);target.append(article);});if(!(data.items||[]).length)target.textContent='لا توجد اقتراحات حتى الآن.';}
    catch(error){target.textContent=error.message||'تعذر تحميل الاقتراحات.';}
  });
})();
