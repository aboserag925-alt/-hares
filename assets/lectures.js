(function () {
  'use strict';
  const host = document.getElementById('managedLectures');
  if (!host) return;
  let base = typeof window.AHL_API_BASE_URL === 'string' ? window.AHL_API_BASE_URL : '';
  while (base.endsWith('/')) base = base.slice(0, -1);
  const grid = document.createElement('div');
  grid.className = 'managed-lecture-grid';
  const heading = document.createElement('h3');
  heading.textContent = 'المواعيد والمحاضرات القادمة';
  heading.className = 'managed-lecture-heading';
  host.appendChild(heading);
  host.appendChild(grid);
  const style = document.createElement('style');
  style.textContent = '.managed-lectures{grid-column:1/-1;margin-top:18px}.managed-lecture-heading{color:var(--gold2,var(--gold,#d5ab64));margin:0 0 12px;font-size:20px}.managed-lecture-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}.managed-lecture{padding:17px;border:1px solid rgba(213,171,100,.22);border-radius:16px;background:linear-gradient(145deg,rgba(25,32,29,.96),rgba(18,23,21,.98));min-width:0}.managed-lecture h4{margin:0 0 7px;color:#f2d9a4;font-size:17px}.managed-lecture p{margin:5px 0;color:#a9ada2;font-size:13px;line-height:1.8}.managed-lecture-links{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.managed-lecture-links a{color:#f2d9a4;border:1px solid rgba(213,171,100,.25);border-radius:10px;padding:6px 10px;text-decoration:none;font-size:12px}';
  document.head.appendChild(style);
  function link(parent, label, value) {
    if (!value) return;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return;
      const a = document.createElement('a');
      a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = label;
      parent.appendChild(a);
    } catch (_) {}
  }
  fetch(base + '/api/lectures').then(function (response) {
    if (!response.ok) throw new Error('unavailable');
    return response.json();
  }).then(function (payload) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) { host.hidden = true; return; }
    items.forEach(function (item) {
      const card = document.createElement('article'); card.className = 'managed-lecture';
      const title = document.createElement('h4'); title.textContent = item.title || 'محاضرة'; card.appendChild(title);
      if (item.starts_at) { const time = document.createElement('p'); const date = new Date(item.starts_at); if (Number.isFinite(date.getTime())) time.textContent = date.toLocaleString('ar-EG'); card.appendChild(time); }
      if (item.description) { const description = document.createElement('p'); description.textContent = item.description; card.appendChild(description); }
      const links = document.createElement('div'); links.className = 'managed-lecture-links';
      link(links, 'مشاهدة البث', item.stream_url); link(links, 'مشاهدة التسجيل', item.recording_url);
      if (links.childNodes.length) card.appendChild(links);
      grid.appendChild(card);
    });
  }).catch(function () {
    host.hidden = true;
  });
})();
