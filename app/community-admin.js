(function () {
  'use strict';
  var config = window.AHL_SUPABASE_CONFIG || {};
  var base = typeof config.url === 'string' ? config.url.replace(/\/+$/, '') : '';
  var anonKey = typeof config.anonKey === 'string' ? config.anonKey : '';
  var host = document.getElementById('communityAdminList');
  var statusNode = document.getElementById('communityAdminStatus');
  if (!host || !statusNode) return;

  function status(message, error) {
    statusNode.textContent = message;
    statusNode.className = 'status' + (error ? ' error' : '');
  }
  async function request(table, query, method, body) {
    if (!base || !anonKey) throw new Error('إعداد Supabase غير مكتمل.');
    var token = await window.ahlAuth.getAccessToken();
    if (!token) throw new Error('انتهت جلسة المشرف. سجّل الدخول مجددًا.');
    var response = await fetch(base + '/rest/v1/' + table + (query ? '?' + query : ''), {
      method: method || 'GET',
      headers: {
        apikey: anonKey,
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    var result = await response.json().catch(function () { return []; });
    if (!response.ok) throw new Error(result.message || 'تعذر تحميل بيانات المراجعة. تحقق من تطبيق ترحيل المنتدى وصلاحيات admin_users.');
    return result;
  }
  function button(label, className, action) {
    var node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.className = className || '';
    node.addEventListener('click', action);
    return node;
  }
  function card(titleText, detailText) {
    var article = document.createElement('article');
    article.className = 'item';
    var copy = document.createElement('div');
    var title = document.createElement('h3');
    title.textContent = titleText;
    var detail = document.createElement('p');
    detail.textContent = detailText;
    copy.append(title, detail);
    var actions = document.createElement('div');
    actions.className = 'actions';
    article.append(copy, actions);
    return { article: article, actions: actions };
  }
  async function change(table, id, method, body) {
    await request(table, 'id=eq.' + encodeURIComponent(id), method, body);
    await load();
  }
  function addModerationActions(target, table, id, statusValue) {
    if (statusValue === 'pending') {
      target.append(
        button('اعتماد ونشر', 'primary', function () { change(table, id, 'PATCH', { status: 'published' }).catch(function (e) { status(e.message, true); }); }),
        button('إخفاء', '', function () { change(table, id, 'PATCH', { status: 'hidden' }).catch(function (e) { status(e.message, true); }); })
      );
    } else if (table === 'community_reports' && statusValue === 'open') {
      target.append(
        button('تمت المعالجة', 'primary', function () { change(table, id, 'PATCH', { status: 'resolved' }).catch(function (e) { status(e.message, true); }); }),
        button('إغلاق البلاغ', '', function () { change(table, id, 'PATCH', { status: 'dismissed' }).catch(function (e) { status(e.message, true); }); })
      );
    }
    target.append(button('حذف', 'danger', function () {
      if (!window.confirm('هل تريد حذف هذا المحتوى نهائيًا؟')) return;
      change(table, id, 'DELETE').catch(function (e) { status(e.message, true); });
    }));
  }
  async function load() {
    host.replaceChildren();
    status('جارٍ تحميل المشاركات والبلاغات…');
    try {
      var results = await Promise.all([
        request('community_topics', 'select=id,title,topic_type,category,created_at,status&status=eq.pending&order=created_at.asc'),
        request('community_posts', 'select=id,topic_id,author_label,content,created_at,status&status=eq.pending&order=created_at.asc'),
        request('community_reports', 'select=id,topic_id,post_id,reason,created_at,status&status=eq.open&order=created_at.asc')
      ]);
      var topics = results[0] || [], posts = results[1] || [], reports = results[2] || [];
      var heading = document.createElement('h3');
      heading.textContent = 'موضوعات بانتظار الاعتماد (' + topics.length + ')';
      host.appendChild(heading);
      topics.forEach(function (item) {
        var entry = card(item.title, (item.topic_type === 'debate' ? 'مناظرة' : 'منتدى') + ' · ' + (item.category || 'عام') + ' · ' + new Date(item.created_at).toLocaleString('ar-EG'));
        addModerationActions(entry.actions, 'community_topics', item.id, item.status);
        host.appendChild(entry.article);
      });
      var postHeading = document.createElement('h3');
      postHeading.textContent = 'ردود بانتظار الاعتماد (' + posts.length + ')';
      host.appendChild(postHeading);
      posts.forEach(function (item) {
        var entry = card(item.author_label, String(item.content || '').slice(0, 500) + ' · ' + new Date(item.created_at).toLocaleString('ar-EG'));
        addModerationActions(entry.actions, 'community_posts', item.id, item.status);
        host.appendChild(entry.article);
      });
      var reportHeading = document.createElement('h3');
      reportHeading.textContent = 'بلاغات مفتوحة (' + reports.length + ')';
      host.appendChild(reportHeading);
      reports.forEach(function (item) {
        var entry = card('بلاغ على محتوى', item.reason + ' · ' + new Date(item.created_at).toLocaleString('ar-EG'));
        addModerationActions(entry.actions, 'community_reports', item.id, item.status);
        host.appendChild(entry.article);
      });
      if (!topics.length && !posts.length && !reports.length) {
        var empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'لا توجد مشاركات معلقة أو بلاغات مفتوحة.';
        host.appendChild(empty);
      }
      status('تم تحديث قائمة المراجعة.');
    } catch (error) {
      status(error.message, true);
    }
  }
  var refresh = document.getElementById('communityAdminRefresh');
  if (refresh) refresh.addEventListener('click', load);
  window.ahlCommunityAdmin = { load: load };
  if (!document.getElementById('adminPanel').hidden) load();
})();
