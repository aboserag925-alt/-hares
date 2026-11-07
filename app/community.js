(function () {
  'use strict';
  var config = window.AHL_SUPABASE_CONFIG || {};
  var base = typeof config.url === 'string' ? config.url.replace(/\/+$/, '') : '';
  var anonKey = typeof config.anonKey === 'string' ? config.anonKey : '';
  var loaded = { debates: false, forum: false };
  var activeTopic = { debates: null, forum: null };
  var cachedUser = null;
  var userResolved = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function status(section, message, error) {
    var node = document.getElementById(section + 'Status');
    if (!node) return;
    node.textContent = message;
    node.className = 'status' + (error ? ' error' : '');
  }
  async function request(table, query, options) {
    if (!base || !anonKey) throw new Error('إعداد Supabase غير متاح في هذه النسخة.');
    var token = null;
    if (window.ahlAuth && window.ahlAuth.configured) token = await window.ahlAuth.getAccessToken();
    var headers = { apikey: anonKey, Authorization: 'Bearer ' + (token || anonKey), Accept: 'application/json' };
    if (options && options.body) {
      headers['Content-Type'] = 'application/json';
      headers.Prefer = 'return=representation';
    }
    var response = await fetch(base + '/rest/v1/' + table + (query ? '?' + query : ''), {
      method: options && options.method || 'GET',
      headers: headers,
      body: options && options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
    var payload = await response.json().catch(function () { return []; });
    if (!response.ok) {
      var message = payload && payload.message ? payload.message : 'تعذر إتمام الطلب.';
      if (response.status === 401 || response.status === 403) message = 'سجّل الدخول أو تحقق من صلاحيات قاعدة البيانات.';
      throw new Error(message);
    }
    return payload;
  }
  function signedIn() {
    return userResolved && Boolean(cachedUser);
  }
  async function currentUser() {
    if (!window.ahlAuth || !window.ahlAuth.configured) { cachedUser = null; userResolved = true; return null; }
    try { cachedUser = await window.ahlAuth.getCurrentUser(); }
    catch (error) { cachedUser = null; }
    userResolved = true;
    return cachedUser;
  }
  function makeLoginPrompt(container) {
    var note = el('div', 'community-empty', 'القراءة متاحة للجميع. للمشاركة وإنشاء موضوع، سجّل الدخول أولًا.');
    var button = el('button', 'community-toggle', 'الانتقال إلى حسابي');
    button.type = 'button';
    button.addEventListener('click', function () { if (typeof window.show === 'function') window.show('account'); else location.hash = '#account'; });
    note.appendChild(document.createTextNode(' '));
    note.appendChild(button);
    container.appendChild(note);
  }
  function createForm(kind, container) {
    container.replaceChildren();
    if (!signedIn()) { makeLoginPrompt(container); return; }
    var debate = kind === 'debate';
    var form = el('form', 'community-form');
    var heading = el('strong', '', debate ? 'اقتراح مناظرة جديدة' : 'إنشاء موضوع جديد');
    var title = el('input'); title.required = true; title.minLength = 5; title.maxLength = 180; title.placeholder = 'عنوان الموضوع';
    var category = el('input'); category.required = true; category.maxLength = 80; category.value = debate ? 'مناظرات علمية' : 'عام'; category.placeholder = 'التصنيف';
    var description = el('textarea'); description.maxLength = 4000; description.placeholder = debate ? 'موضوع المناظرة ومحاورها والمصادر المقترحة' : 'اكتب وصفًا مختصرًا للنقاش';
    var participantA, participantB;
    if (debate) {
      participantA = el('input'); participantA.required = true; participantA.maxLength = 100; participantA.placeholder = 'الطرف الأول';
      participantB = el('input'); participantB.required = true; participantB.maxLength = 100; participantB.placeholder = 'الطرف الثاني';
    }
    var submit = el('button', 'btn', debate ? 'نشر المناظرة' : 'نشر الموضوع'); submit.type = 'submit';
    form.append(heading, title, category);
    if (debate) form.append(participantA, participantB);
    form.append(description, submit);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      submit.disabled = true;
      try {
        var user = await currentUser();
        if (!user) throw new Error('انتهت جلسة الدخول. سجّل الدخول مرة أخرى.');
        var row = { topic_type: kind, title: title.value.trim(), category: category.value.trim(), description: description.value.trim(), created_by: user.id, status: 'pending' };
        if (debate) { row.participant_a = participantA.value.trim(); row.participant_b = participantB.value.trim(); }
        await request('community_topics', 'select=id', { method: 'POST', body: row });
        form.reset();
        status(kind === 'debate' ? 'debates' : 'forum', 'تم إرسال الموضوع للمراجعة قبل ظهوره للزوار.');
        loaded[kind === 'debate' ? 'debates' : 'forum'] = false;
        await load(kind === 'debate' ? 'debates' : 'forum');
      } catch (error) {
        status(kind === 'debate' ? 'debates' : 'forum', error.message, true);
      } finally { submit.disabled = false; }
    });
    container.appendChild(form);
  }
  function renderPosts(section, topic, posts, host) {
    var wrapper = el('div');
    posts.forEach(function (post) {
      var item = el('article', 'community-post');
      var meta = el('div', 'community-meta', post.author_label + ' · ' + new Date(post.created_at).toLocaleString('ar-EG'));
      if (section === 'debates') meta.appendChild(el('span', '', 'الجولة ' + post.round_number));
      var body = el('p', '', post.content + (post.status === 'pending' ? '\n(بانتظار مراجعة الإدارة)' : ''));
      var report = el('button', 'community-toggle', 'إبلاغ');
      report.type = 'button';
      report.addEventListener('click', async function () {
        try {
          var user = await currentUser();
          if (!user) throw new Error('سجّل الدخول للإبلاغ عن مشاركة.');
          var reason = window.prompt('اكتب سبب الإبلاغ باختصار:');
          if (!reason) return;
          await request('community_reports', '', { method: 'POST', body: { topic_id: topic.id, post_id: post.id, reporter_id: user.id, reason: reason.trim().slice(0,500) } });
          status(section, 'تم إرسال البلاغ إلى الإدارة.');
        } catch (error) { status(section, error.message, true); }
      });
      item.append(meta, body);
      if (signedIn()) item.appendChild(report);
      wrapper.appendChild(item);
    });
    if (!posts.length) wrapper.appendChild(el('div', 'community-empty', 'لا توجد ردود بعد. كن أول من يشارك.'));
    host.replaceChildren(wrapper);
  }
  async function openTopic(section, topic, card) {
    if (activeTopic[section] === topic.id) { activeTopic[section] = null; var existing=card.querySelector('.community-topic-detail'); if(existing) existing.remove(); return; }
    activeTopic[section] = topic.id;
    var detail = el('div', 'community-topic-detail');
    detail.appendChild(el('p', '', topic.description || 'لا يوجد وصف إضافي.'));
    var postsHost = el('div');
    detail.appendChild(postsHost);
    var replyForm = el('form', 'community-form');
    if (signedIn()) {
      var name = el('input'); name.required = true; name.maxLength = 80; name.placeholder = 'الاسم الظاهر في النقاش';
      var content = el('textarea'); content.required = true; content.minLength = 2; content.maxLength = 5000; content.placeholder = 'اكتب ردك بأدب واحترام…';
      var round = null;
      if (section === 'debates') { round = el('select'); for (var i=1;i<=20;i++){var option=el('option','', 'الجولة '+i);option.value=String(i);round.appendChild(option);} }
      var send = el('button','btn','إرسال الرد'); send.type='submit';
      replyForm.append(name); if(round) replyForm.append(round); replyForm.append(content,send);
      replyForm.addEventListener('submit', async function(event){
        event.preventDefault(); send.disabled=true;
        try {
          var user=await currentUser(); if(!user) throw new Error('سجّل الدخول مرة أخرى.');
          await request('community_posts','select=id',{method:'POST',body:{topic_id:topic.id,author_id:user.id,author_label:name.value.trim(),content:content.value.trim(),round_number:round?Number(round.value):null,status:'pending'}});
          content.value=''; status(section,'تم إرسال ردك للمراجعة قبل ظهوره.'); await refreshPosts();
        } catch(error){status(section,error.message,true);} finally{send.disabled=false;}
      });
    } else { makeLoginPrompt(replyForm); }
    detail.appendChild(postsHost); detail.appendChild(replyForm);
    card.appendChild(detail);
    async function refreshPosts(){
      try {
        var rows=await request('community_posts','select=id,topic_id,author_id,author_label,content,round_number,status,created_at&topic_id=eq.'+encodeURIComponent(topic.id)+'&order=created_at.asc&limit=100');
        renderPosts(section,topic,rows,postsHost);
      } catch(error){postsHost.replaceChildren(el('div','community-empty',error.message));}
    }
    await refreshPosts();
  }
  function renderTopics(section, topics) {
    var list = document.getElementById(section + 'List');
    list.replaceChildren();
    if (!topics.length) { list.appendChild(el('div','community-empty','لا توجد موضوعات منشورة بعد.')); return; }
    topics.forEach(function(topic){
      var card=el('article','community-topic');
      var title=el('h3','',topic.title);
      var meta=el('div','community-meta',topic.category+' · '+new Date(topic.created_at).toLocaleDateString('ar-EG')+(topic.status==='pending'?' · بانتظار مراجعة الإدارة':''));
      card.append(title,meta);
      if(section==='debates') card.appendChild(el('p','', 'الطرف الأول: '+topic.participant_a+'  |  الطرف الثاني: '+topic.participant_b));
      var button=el('button','community-toggle',section==='debates'?'عرض الجولات والردود':'عرض النقاش والردود'); button.type='button';
      button.addEventListener('click',function(){openTopic(section,topic,card);});
      card.appendChild(button); list.appendChild(card);
    });
  }
  async function load(section) {
    if (section !== 'debates' && section !== 'forum') return;
    var kind = section === 'debates' ? 'debate' : 'forum';
    await currentUser();
    var createHost = document.getElementById(section + 'Create');
    createForm(kind, createHost);
    status(section,'جارٍ تحميل الموضوعات…');
    try {
      var topicStatus = signedIn() ? 'in.(published,pending)' : 'eq.published';
      var topics=await request('community_topics','select=id,topic_type,title,description,category,participant_a,participant_b,status,created_at&topic_type=eq.'+kind+'&status='+topicStatus+'&order=created_at.desc&limit=50');
      renderTopics(section,topics);
      loaded[section]=true;
      status(section,topics.length?'تم تحميل '+topics.length+' موضوعًا.':'لا توجد موضوعات منشورة حتى الآن.');
    } catch(error){ status(section,error.message,true); }
  }
  window.ahlCommunity = { load: load };
  if (location.hash === '#debates' || location.hash === '#forum') load(location.hash.slice(1));
})();
