'use strict';
(function(){
  var auth=window.ahlAuth;
  var loginPanel=document.getElementById('loginPanel');
  var dashboard=document.getElementById('dashboard');
  var loginStatus=document.getElementById('loginStatus');
  var dashboardStatus=document.getElementById('dashboardStatus');
  var lectureList=document.getElementById('lectureList');
  var currentUser=null;
  var items=[];
  function status(el,message,error){el.textContent=message;el.className='status'+(error?' error':' ok');}
  function showUser(user){
    currentUser=user||null;
    var allowed=Boolean(auth&&auth.isSiteAdmin(user));
    loginPanel.hidden=allowed;
    dashboard.hidden=!allowed;
    if(user&&!allowed) status(loginStatus,'هذا الحساب لا يملك صلاحية إدارة الموقع. اطلب منح الدور site_admin من مسؤول المشروع.',true);
    if(allowed){status(loginStatus,'تم تسجيل الدخول بنجاح.');refresh();}
  }
  function requireAdmin(){
    if(!currentUser||!auth.isSiteAdmin(currentUser)) throw new Error('ليس لديك صلاحية إدارة الموقع.');
  }
  function validHttps(value){
    var url=new URL(value);
    if(url.protocol!=='https:') throw new Error('يجب أن يكون الرابط آمنًا ويبدأ بـ HTTPS.');
    return url.toString();
  }
  async function refresh(){
    try{
      requireAdmin();
      items=await auth.listManageableSiteContent();
      renderLectures();
      var live=items.find(function(x){return x.content_key==='livestream';});
      if(live){
        document.getElementById('liveTitle').value=live.title||'';
        document.getElementById('liveUrl').value=(live.data&&live.data.url)||'';
        document.getElementById('liveTime').value=(live.data&&live.data.scheduled_at)||'';
        document.getElementById('liveStatus').value=(live.data&&live.data.status)||'scheduled';
        document.getElementById('livePublished').checked=Boolean(live.published);
      }
      var schedule=items.find(function(x){return x.content_key==='schedule';});
      if(schedule){
        document.getElementById('scheduleData').value=JSON.stringify(schedule.data&&schedule.data.days||[],null,2);
        document.getElementById('schedulePublished').checked=Boolean(schedule.published);
      }
      status(dashboardStatus,'تم تحميل البيانات المحفوظة.');
    }catch(error){status(dashboardStatus,error.message,true);}
  }
  function renderLectures(){
    lectureList.replaceChildren();
    var lectures=items.filter(function(x){return x.content_type==='lecture';});
    if(!lectures.length){var empty=document.createElement('p');empty.textContent='لا توجد محاضرات محفوظة بعد.';lectureList.appendChild(empty);return;}
    lectures.forEach(function(item){
      var row=document.createElement('div');row.className='item';
      var info=document.createElement('div');
      var title=document.createElement('strong');title.textContent=item.title;
      var meta=document.createElement('small');meta.textContent=(item.data.category||'دون تصنيف')+' · '+(item.published?'منشورة':'مسودة');
      info.append(title,meta);
      var actions=document.createElement('div');actions.className='actions';
      var edit=document.createElement('button');edit.type='button';edit.textContent='تعديل';edit.addEventListener('click',function(){editLecture(item);});
      var remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='حذف';remove.addEventListener('click',function(){removeLecture(item);});
      actions.append(edit,remove);row.append(info,actions);lectureList.appendChild(row);
    });
  }
  function editLecture(item){
    document.getElementById('lectureKey').value=item.content_key;
    document.getElementById('lectureTitle').value=item.title||'';
    document.getElementById('lectureCategory').value=item.data.category||'';
    document.getElementById('lectureUrl').value=item.data.url||'';
    document.getElementById('lectureDate').value=item.data.date||'';
    document.getElementById('lectureDescription').value=item.data.description||'';
    document.getElementById('lecturePublished').checked=Boolean(item.published);
    document.getElementById('lectureTitle').focus();
  }
  function resetLecture(){document.getElementById('lectureForm').reset();document.getElementById('lectureKey').value='';}
  async function removeLecture(item){
    if(!window.confirm('هل تريد حذف هذه المحاضرة؟'))return;
    try{requireAdmin();await auth.deleteSiteContent(item.content_key);await refresh();status(dashboardStatus,'تم حذف المحاضرة.');}
    catch(error){status(dashboardStatus,error.message,true);}
  }
  document.getElementById('loginForm').addEventListener('submit',async function(event){
    event.preventDefault();
    if(!auth||!auth.configured){status(loginStatus,'إعداد Supabase غير موجود. أضف رابط المشروع والمفتاح العام ثم أعد بناء التطبيق.',true);return;}
    status(loginStatus,'جارٍ تسجيل الدخول…');
    try{
      var result=await auth.signIn(document.getElementById('email').value.trim(),document.getElementById('password').value);
      if(result.error)throw result.error;
      showUser(result.data.user);
    }catch(error){status(loginStatus,error.message||'تعذر تسجيل الدخول.',true);}
  });
  document.getElementById('logoutBtn').addEventListener('click',async function(){
    try{await auth.signOut();showUser(null);status(loginStatus,'تم تسجيل الخروج.');}
    catch(error){status(dashboardStatus,error.message,true);}
  });
  document.getElementById('liveForm').addEventListener('submit',async function(event){
    event.preventDefault();
    try{
      requireAdmin();
      var title=document.getElementById('liveTitle').value.trim();
      var url=validHttps(document.getElementById('liveUrl').value.trim());
      await auth.saveSiteContent({content_key:'livestream',content_type:'livestream',title:title,data:{url:url,scheduled_at:document.getElementById('liveTime').value,status:document.getElementById('liveStatus').value},published:document.getElementById('livePublished').checked});
      await refresh();status(dashboardStatus,'تم حفظ إعدادات البث.');
    }catch(error){status(dashboardStatus,error.message,true);}
  });
  document.getElementById('scheduleForm').addEventListener('submit',async function(event){
    event.preventDefault();
    try{
      requireAdmin();
      var days=JSON.parse(document.getElementById('scheduleData').value);
      if(!Array.isArray(days)||days.length>7||days.some(function(day){return !day||typeof day.day!=='string'||!Array.isArray(day.lessons)||day.lessons.some(function(x){return typeof x!=='string';});})) throw new Error('صيغة الجدول غير صحيحة. استخدم قائمة أيام، ولكل يوم قائمة دروس نصية.');
      await auth.saveSiteContent({content_key:'schedule',content_type:'schedule',title:'جدول الدروس الأسبوعي',data:{days:days},published:document.getElementById('schedulePublished').checked});
      await refresh();status(dashboardStatus,'تم حفظ جدول المواعيد.');
    }catch(error){status(dashboardStatus,error.message||'تعذر حفظ الجدول.',true);}
  });
  document.getElementById('lectureForm').addEventListener('submit',async function(event){
    event.preventDefault();
    try{
      requireAdmin();
      var key=document.getElementById('lectureKey').value||('lecture-'+crypto.randomUUID());
      var title=document.getElementById('lectureTitle').value.trim();
      var url=validHttps(document.getElementById('lectureUrl').value.trim());
      await auth.saveSiteContent({content_key:key,content_type:'lecture',title:title,data:{category:document.getElementById('lectureCategory').value.trim(),url:url,date:document.getElementById('lectureDate').value,description:document.getElementById('lectureDescription').value.trim()},published:document.getElementById('lecturePublished').checked});
      resetLecture();await refresh();status(dashboardStatus,'تم حفظ المحاضرة.');
    }catch(error){status(dashboardStatus,error.message||'تعذر حفظ المحاضرة.',true);}
  });
  document.getElementById('resetLecture').addEventListener('click',resetLecture);
  if(!auth||!auth.configured){status(loginStatus,'لم يتم إعداد Supabase بعد. يلزم إنشاء المشروع وتشغيل ملفات SQL وإضافة إعدادات المشروع العامة.',true);return;}
  auth.init(function(state){showUser(state.user);});
})();
