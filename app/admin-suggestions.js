'use strict';
(function(){
  const panel=document.getElementById('adminPanel');if(!panel||document.getElementById('haresSuggestionsAdmin'))return;
  const section=document.createElement('section');section.id='haresSuggestionsAdmin';section.className='panel';section.dir='rtl';section.hidden=true;section.innerHTML='<h2>لوحة تطوير المنصة بالذكاء الاصطناعي</h2><p>اقتراحات المستخدمين — عرض إداري للقراءة فقط في هذه المرحلة.</p><button type="button" id="haresLoadSuggestions">تحميل الاقتراحات</button><div id="haresSuggestionsList" aria-live="polite"></div>';
  const anchor=document.getElementById('listPanel');if(anchor)anchor.after(section);else panel.after(section);
  if(typeof MutationObserver==='function')new MutationObserver(()=>{section.hidden=panel.hidden;}).observe(panel,{attributes:true,attributeFilter:['hidden']});
  section.querySelector('button').addEventListener('click',async()=>{
    const target=section.querySelector('#haresSuggestionsList');target.textContent='جارٍ التحميل…';
    try{const token=await window.ahlAuth.getAccessToken();const base=String(window.AHL_API_BASE_URL||'').replace(/\/+$/,'');const response=await fetch(base+'/api/admin/suggestions',{headers:{Authorization:'Bearer '+token}});const data=await response.json();if(!response.ok)throw Error(data.error||'تعذر تحميل الاقتراحات');target.textContent='';(data.items||[]).forEach(item=>{const article=document.createElement('article');article.className='item';const title=document.createElement('h3');title.textContent=item.title;const details=document.createElement('p');details.textContent=item.description;const meta=document.createElement('p');meta.textContent='التصنيف: '+item.category+' · الحالة: '+item.status+' · الأولوية: '+item.priority+' · الخطورة: '+item.risk;article.append(title,details,meta);
      const analyzeButton=document.createElement('button');analyzeButton.type='button';analyzeButton.textContent='تحليل الاقتراح بالنماذج';analyzeButton.setAttribute('aria-label','تحليل الاقتراح: '+item.title);
      const analysisStatus=document.createElement('p');analysisStatus.setAttribute('aria-live','polite');
      analyzeButton.addEventListener('click',async()=>{
        analyzeButton.disabled=true;analysisStatus.textContent='جارٍ التحليل الآمن…';
        try{
          const token=await window.ahlAuth.getAccessToken();
          const base=String(window.AHL_API_BASE_URL||'').replace(/\\/+$/,'');
          const response=await fetch(base+'/api/admin/suggestions/'+encodeURIComponent(item.id)+'/analyze',{method:'POST',headers:{Authorization:'Bearer '+token}});
          const data=await response.json();
          if(!response.ok)throw Error(data.error||'تعذر تحليل الاقتراح');
          const summaries=Object.entries(data.models||{}).map(([name,result])=>name+': '+(result.summary||'اكتمل التحليل'));
          analysisStatus.textContent='تم التحليل — '+summaries.join(' | ')+' — المهمة موسومة بأنها غير موثوقة وتحتاج مراجعة بشرية.';
          meta.textContent+=' · تحليل محفوظ';
        }catch(error){analysisStatus.textContent=error.message||'تعذر تحليل الاقتراح.';}
        finally{analyzeButton.disabled=false;}
      });
      article.append(analyzeButton,analysisStatus);target.append(article);});if(!(data.items||[]).length)target.textContent='لا توجد اقتراحات حتى الآن.';}
    catch(error){target.textContent=error.message||'تعذر تحميل الاقتراحات.';}
  });
})();
