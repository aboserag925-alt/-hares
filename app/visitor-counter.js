'use strict';

(function () {
  var counters = document.querySelectorAll('[data-daily-visitors]');
  if (!counters.length || !window.fetch || !window.localStorage) return;

  var dnt = navigator.doNotTrack === '1' ||
    window.doNotTrack === '1' ||
    navigator.msDoNotTrack === '1';
  if (dnt) {
    counters.forEach(function (node) { node.hidden = true; });
    return;
  }

  var visitorId;
  try {
    visitorId = window.localStorage.getItem('ahl_daily_visitor_id');
    if (!visitorId) {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        visitorId = window.crypto.randomUUID();
      } else {
        var bytes = new Uint8Array(16);
        if (!window.crypto || !window.crypto.getRandomValues) return;
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.prototype.map.call(bytes, function (value) {
          return value.toString(16).padStart(2, '0');
        }).join('');
        visitorId = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' +
          hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
      }
      window.localStorage.setItem('ahl_daily_visitor_id', visitorId);
    }
  } catch (error) {
    return;
  }

  var base = typeof window.AHL_API_BASE_URL === 'string' ? window.AHL_API_BASE_URL : '';
  while (base.endsWith('/')) base = base.slice(0, -1);
  window.fetch(base + '/api/analytics/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId: visitorId }),
    cache: 'no-store'
  }).then(function (response) {
    if (!response.ok) throw new Error('Analytics unavailable');
    return response.json();
  }).then(function (data) {
    if (!Number.isFinite(data.visitors)) return;
    counters.forEach(function (node) {
      var value = node.querySelector('[data-visitor-count-value]');
      if (value) value.textContent = new Intl.NumberFormat('ar-EG').format(data.visitors);
    });
  }).catch(function () {
    // The site remains usable when analytics is not configured or temporarily unavailable.
  });
})();
