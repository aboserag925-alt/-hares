'use strict';
(function(){
  var api=window.ahlAuth;
  if(!api||!api.configured)return;
  var notice=document.getElementById('broadcastNotice');
  var liveButtons=document.querySelectorAll('#live a');
  var scheduleRoot=document.getElementById('scheduleRows');
  var archiveRoot=document.getElementById('lectureArchive');
  function node(tag,text,className){
    var element=document.createElement(tag);
    if(text!==undefined)element.textContent=text;
    if(className)element.className=className;
    return element;
  }
  function safeLink(value){
    try{var url=new URL(value);return url.protocol==='https:'?url.toString():null;}catch(error){return null;}
  }
  function renderLive(item){
    if(!item||!item.published||!item.data||!safeLink(item.data.url))return;
    if(notice){
      var label=item.data.status==='live'?'البث مباشر الآن':item.data.status==='ended'?'انتهى البث':'البث القادم';
      var text=item.title+' — '+label;
      if(item.data.scheduled_at&&item.data.status!=='live'){
        var date=new Date(item.data.scheduled_at);
        if(!Number.isNaN(date.getTime()))text+=' · '+new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(date);
      }
      notice.replaceChildren(node('span',undefined,'dot'),document.createTextNode(text));
    }
    if(liveButtons[0]){
      liveButtons[0].href=safeLink(item.data.url);
      liveButtons[0].textContent=item.data.status==='live'?'شاهد البث المباشر':'تفاصيل البث';
      liveButtons[0].target='_blank';
      liveButtons[0].rel='noopener noreferrer';
    }
  }
  function renderSchedule(item){
    if(!scheduleRoot||!item||!item.published||!item.data||!Array.isArray(item.data.days))return;
    scheduleRoot.replaceChildren();
    item.data.days.forEach(function(day){
      if(!day||typeof day.day!=='string'||!Array.isArray(day.lessons))return;
      var row=node('div',undefined,'row rv');
      row.appendChild(node('b',day.day));
      row.appendChild(node('span',day.lessons[0]||''));
      row.appendChild(node('span',day.lessons[1]||''));
      scheduleRoot.appendChild(row);
    });
  }
  function renderLectures(items){
    if(!archiveRoot)return;
    var lectures=items.filter(function(item){return item.content_type==='lecture'&&item.published&&item.data&&safeLink(item.data.url);});
    if(!lectures.length)return;
    archiveRoot.replaceChildren();
    lectures.forEach(function(item){
      var card=node('article',undefined,'card rv');
      var link=node('a',undefined,'lecture-public-link');
      link.href=safeLink(item.data.url);
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.style.color='inherit';
      link.style.textDecoration='none';
      var heading=node('h3',item.title);
      var category=node('span',item.data.category||'محاضرة','tag');
      var description=node('p',item.data.description||'استمع إلى التسجيل الكامل.');
      link.append(category,heading,description);
      card.appendChild(link);
      archiveRoot.appendChild(card);
    });
  }
  api.listPublishedSiteContent().then(function(items){
    renderLive(items.find(function(item){return item.content_key==='livestream';}));
    renderSchedule(items.find(function(item){return item.content_key==='schedule';}));
    renderLectures(items);
  }).catch(function(){
    // Keep the carefully reviewed static fallback if the public content service is unavailable.
  });
})();
