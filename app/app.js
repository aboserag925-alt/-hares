'use strict';

var S = [
  ['السبت', 'شرح صحيح الإمام مسلم', 'شرح علم مصطلح الحديث'],
  ['الأحد', 'مناهج البيان في أصول التفسير وقواعد فهم القرآن', 'قواعد عقائد أهل السنة والجماعة'],
  ['الإثنين', 'شرح صحيح الإمام مسلم', 'شرح علم مصطلح الحديث'],
  ['الثلاثاء', 'شرح العقيدة الواسطية', 'أصول الفقه'],
  ['الأربعاء', 'شرح صحيح الإمام مسلم', 'شرح علم مصطلح الحديث'],
  ['الخميس', 'عظماء الإسلام', 'منوعات ومقتطفات وحوارات']
];
var names = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
var prayerSections = ['sched', 'prayers', 'qibla', 'adhkar', 'media', 'q', 'account', 'about'];
var prayerTabs = ['t1', 't2', 't3', 't4', 't5', 't6', 't8', 't7'];
var prayerNames = {
  fajr: 'الفجر',
  sunrise: 'الشروق',
  dhuhr: 'الظهر',
  asr: 'العصر',
  maghrib: 'المغرب',
  isha: 'العشاء'
};
var prayerKeys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
var salatKeys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
var prayerLocation = null;
var prayerTimesCache = null;
var nextPrayerAt = null;
var nextPrayerName = '';
var compassHeading = null;
var currentDhikrPeriod = 'morning';
var deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
var accountUser = null;
var accountSyncTimer = null;
var activeSyncUserId = null;
var mediaItems = [];
var activeMediaCategory = 'all';
var prayerStatus = document.getElementById('locationStatus');
var compassStatus = document.getElementById('compassStatus');
var audioStatus = document.getElementById('audioStatus');

function setStatus(element, message, isError) {
  element.textContent = message;
  element.className = 'status' + (isError ? ' error' : '');
}

function apiUrl(path) {
  var baseUrl = typeof window.AHL_API_BASE_URL === 'string'
    ? window.AHL_API_BASE_URL.replace(/\/+$/, '')
    : '';
  return baseUrl + path;
}

function saveValue(key, value, statusElement) {
  try {
    localStorage.setItem(key, value);
    if (key === 'ahl-athar-calculation-method' || key === 'ahl-athar-asr-madhab' ||
        key.indexOf('ahl-athar-dhikr-') === 0) {
      scheduleAccountSync();
    }
    return true;
  } catch (error) {
    setStatus(statusElement, 'تعذر حفظ الإعدادات على هذا الجهاز.', true);
    return false;
  }
}

function loadPosition() {
  try {
    var latitude = Number(localStorage.getItem('ahl-athar-latitude'));
    var longitude = Number(localStorage.getItem('ahl-athar-longitude'));
    if (Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
        Number.isFinite(longitude) && Math.abs(longitude) <= 180 &&
        localStorage.getItem('ahl-athar-latitude') !== null &&
        localStorage.getItem('ahl-athar-longitude') !== null) {
      return { latitude: latitude, longitude: longitude };
    }
  } catch (error) {
    setStatus(prayerStatus, 'تعذر قراءة الموقع المحفوظ. يمكنك إدخاله يدويًا.', true);
  }
  return null;
}

function localDateKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') +
    '-' + String(date.getDate()).padStart(2, '0');
}

function formatTime(date) {
  return new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: deviceTimezone
  }).format(date);
}

function cairo() {
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  }).formatToParts(new Date());
  var values = {};
  parts.forEach(function (part) { values[part.type] = part.value; });
  var day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  return {
    day: day,
    seconds: (Number(values.hour) % 24) * 3600 +
      Number(values.minute) * 60 + Number(values.second)
  };
}

function buildSchedule() {
  var box = document.getElementById('sched');
  var today = names[cairo().day];
  box.textContent = '';
  S.forEach(function (row) {
    var card = document.createElement('div');
    card.className = 'card' + (row[0] === today ? ' today' : '');
    var day = document.createElement('div');
    day.className = 'day';
    day.textContent = row[0] + (row[0] === today ? ' (اليوم)' : '');
    card.appendChild(day);
    [['7:00 مساءً', row[1]], ['10:00 مساءً', row[2]]].forEach(function (slot) {
      var line = document.createElement('div');
      line.className = 'slot';
      var time = document.createElement('span');
      time.className = 'time';
      time.textContent = slot[0];
      var lesson = document.createElement('span');
      lesson.textContent = slot[1];
      line.appendChild(time);
      line.appendChild(lesson);
      card.appendChild(line);
    });
    box.appendChild(card);
  });
  var friday = document.createElement('div');
  friday.className = 'card' + (today === 'الجمعة' ? ' today' : '');
  friday.textContent = 'الجمعة: لا دروس';
  box.appendChild(friday);
}

function updateLessonCountdown() {
  var state = cairo();
  var lessonDays = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
  var slots = [19 * 3600, 22 * 3600];
  for (var offset = 0; offset < 8; offset += 1) {
    var day = (state.day + offset) % 7;
    if (day === 5) continue;
    for (var slot = 0; slot < slots.length; slot += 1) {
      var difference = offset * 86400 + slots[slot] - state.seconds;
      if (difference > 0) {
        var lessons = S[lessonDays.indexOf(names[day])];
        document.getElementById('nx').textContent =
          names[day] + ' ' + (slot === 0 ? '7:00' : '10:00') +
          ' مساءً: ' + lessons[slot + 1];
        var hours = Math.floor(difference / 3600);
        var minutes = Math.floor((difference % 3600) / 60);
        var seconds = difference % 60;
        document.getElementById('cd').textContent =
          String(hours).padStart(2, '0') + ':' +
          String(minutes).padStart(2, '0') + ':' +
          String(seconds).padStart(2, '0');
        return;
      }
    }
  }
}

var sectionStack = ['sched'];

function renderSectionStack() {
  prayerSections.forEach(function (id, index) {
    var position = sectionStack.indexOf(id);
    var visible = position !== -1;
    var section = document.getElementById(id);
    section.hidden = !visible;
    section.classList.toggle('app-section-overlay', visible && position > 0);
    if (visible && position > 0) section.style.zIndex = String(15 + position);
    else section.style.removeProperty('z-index');
    var active = id === sectionStack[sectionStack.length - 1];
    var tab = document.getElementById(prayerTabs[index]);
    tab.className = 'tab' + (active ? ' on' : '');
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function closeTopSection() {
  if (sectionStack.length <= 1) return;
  sectionStack.pop();
  renderSectionStack();
}

function show(sectionId) {
  if (prayerSections.indexOf(sectionId) === -1) return;
  var top = sectionStack[sectionStack.length - 1];
  if (sectionId === 'sched') {
    sectionStack = ['sched'];
  } else if (sectionId !== top) {
    var existing = sectionStack.indexOf(sectionId);
    if (existing >= 0) sectionStack = sectionStack.slice(0, existing + 1);
    else sectionStack.push(sectionId);
  }
  renderSectionStack();
  if (accountUser && window.ahlAuth && window.ahlAuth.configured) {
    window.ahlAuth.logActivity(accountUser.id, 'section_view', { section: sectionId }).catch(function () {});
  }
  if (sectionId === 'qibla') updateQibla();
  if (sectionId === 'adhkar') renderAdhkar();
  if (sectionId === 'media') loadMediaLibrary();
}

prayerSections.forEach(function (id) {
  if (id === 'sched') return;
  var section = document.getElementById(id);
  section.addEventListener('click', function (event) {
    var contentSelector = [
      '.card', '.note', 'button', 'a', 'input', 'select', 'textarea', 'label',
      'audio', '[role="button"]', '[contenteditable="true"]'
    ].join(', ');
    if (!event.target.closest(contentSelector)) closeTopSection();
  });
});

function renderMediaLibrary() {
  var container = document.getElementById('mediaItems');
  var status = document.getElementById('mediaStatus');
  var visibleItems = mediaItems.filter(function (item) {
    return activeMediaCategory === 'all' || item.category === activeMediaCategory;
  });
  container.replaceChildren();
  if (visibleItems.length === 0) {
    status.textContent = mediaItems.length
      ? 'لا توجد مواد في هذا التصنيف.'
      : 'لا توجد مواد منشورة بعد. تُضاف الملفات من مجموعة Telegram بعد اعتمادها.';
    return;
  }
  status.textContent = 'عدد المواد: ' + visibleItems.length;
  visibleItems.forEach(function (item) {
    var card = document.createElement('article');
    card.className = 'media-card';
    var category = document.createElement('span');
    category.className = 'media-category';
    category.textContent = item.categoryName;
    var title = document.createElement('h3');
    title.textContent = item.title;
    var date = document.createElement('time');
    date.className = 'media-date';
    date.dateTime = item.uploadedAt;
    date.textContent = new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' })
      .format(new Date(item.uploadedAt));
    card.append(category, title);

    if (item.kind === 'audio' || item.kind === 'video') {
      var player = document.createElement(item.kind);
      player.controls = true;
      player.preload = 'none';
      player.src = item.url;
      card.appendChild(player);
    } else if (item.kind === 'image') {
      var image = document.createElement('img');
      image.src = item.url;
      image.alt = item.title;
      image.loading = 'lazy';
      card.appendChild(image);
    } else {
      var link = document.createElement('a');
      link.className = 'media-download';
      link.href = item.url;
      link.textContent = 'تحميل ' + item.fileName;
      link.setAttribute('download', '');
      card.appendChild(link);
    }

    card.appendChild(date);
    container.appendChild(card);
  });
}

async function loadMediaLibrary() {
  var status = document.getElementById('mediaStatus');
  status.className = 'status';
  status.textContent = 'جارٍ تحميل المكتبة…';
  try {
    var response = await fetch(apiUrl('/api/library'), { cache: 'no-store' });
    var text = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer());
    var result = JSON.parse(text);
    if (!response.ok || !Array.isArray(result.items)) {
      throw new Error(result.error || 'استجابة المكتبة غير صالحة.');
    }
    mediaItems = result.items;
    renderMediaLibrary();
  } catch (error) {
    status.textContent = error instanceof TypeError
      ? 'تعذر الاتصال بالخادم لتحميل المكتبة.'
      : 'تعذر تحميل المكتبة الآن. حاول مرة أخرى.';
    status.classList.add('error');
  }
}

function methodForTimezone() {
  if (deviceTimezone === 'Africa/Cairo') return 'egypt';
  if (/^Asia\/(Riyadh|Makkah|Kuwait|Qatar|Bahrain)$/.test(deviceTimezone)) return 'umm';
  if (deviceTimezone === 'Asia/Dubai') return 'dubai';
  if (deviceTimezone === 'Asia/Karachi') return 'karachi';
  if (/^Asia\/(Singapore|Kuala_Lumpur|Jakarta)$/.test(deviceTimezone)) return 'singapore';
  if (deviceTimezone === 'Europe/Istanbul') return 'turkey';
  if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Toronto|Vancouver)/.test(deviceTimezone)) {
    return 'mwl';
  }
  return 'mwl';
}

function getCalculationParameters() {
  var selected = document.getElementById('calcMethod').value;
  var method = selected === 'auto' ? methodForTimezone() : selected;
  var methods = {
    egypt: window.adhan.CalculationMethod.Egyptian,
    umm: window.adhan.CalculationMethod.UmmAlQura,
    mwl: window.adhan.CalculationMethod.MuslimWorldLeague,
    dubai: window.adhan.CalculationMethod.Dubai,
    karachi: window.adhan.CalculationMethod.Karachi,
    singapore: window.adhan.CalculationMethod.Singapore,
    turkey: window.adhan.CalculationMethod.Turkey
  };
  var parameters = methods[method]();
  parameters.madhab = document.getElementById('asrMadhab').value === 'hanafi'
    ? window.adhan.Madhab.Hanafi
    : window.adhan.Madhab.Shafi;
  return parameters;
}

function updateLocationStatus(source) {
  if (!prayerLocation) {
    setStatus(prayerStatus, 'لم يُحدَّد الموقع بعد. احفظ موقعًا يدويًا أو اسمح بتحديده تلقائيًا.');
    return;
  }
  var origin = source || 'الموقع محفوظ على هذا الجهاز';
  setStatus(prayerStatus, origin + ' · ' +
    prayerLocation.latitude.toFixed(4) + ', ' +
    prayerLocation.longitude.toFixed(4));
}

function saveLocation() {
  var latitude = Number(document.getElementById('latitude').value);
  var longitude = Number(document.getElementById('longitude').value);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    setStatus(prayerStatus, 'أدخل خط عرض بين -90 و90 وخط طول بين -180 و180.', true);
    return;
  }
  if (!saveValue('ahl-athar-latitude', String(latitude), prayerStatus) ||
      !saveValue('ahl-athar-longitude', String(longitude), prayerStatus)) return;
  prayerLocation = { latitude: latitude, longitude: longitude };
  saveValue('ahl-athar-calculation-method',
    document.getElementById('calcMethod').value, prayerStatus);
  prayerTimesCache = null;
  updateLocationStatus('تم حفظ الموقع');
  updatePrayerTimes(true);
  updateQibla();
}

function locateUser() {
  if (!navigator.geolocation) {
    setStatus(prayerStatus, 'تحديد الموقع غير متاح في هذا المتصفح. أدخل الإحداثيات يدويًا.', true);
    return;
  }
  setStatus(prayerStatus, 'بانتظار إذنك لتحديد الموقع…');
  navigator.geolocation.getCurrentPosition(function (position) {
    prayerLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };
    document.getElementById('latitude').value = prayerLocation.latitude.toFixed(6);
    document.getElementById('longitude').value = prayerLocation.longitude.toFixed(6);
    if (!saveValue('ahl-athar-latitude', String(prayerLocation.latitude), prayerStatus) ||
        !saveValue('ahl-athar-longitude', String(prayerLocation.longitude), prayerStatus)) return;
    prayerTimesCache = null;
    updateLocationStatus('تم تحديد الموقع بإذنك');
    updatePrayerTimes(true);
    updateQibla();
  }, function (error) {
    var messages = {
      1: 'لم يُسمح بالوصول إلى الموقع. يمكنك إدخال الإحداثيات يدويًا.',
      2: 'تعذر تحديد الموقع الآن. تحقق من إعدادات الموقع أو أدخل الإحداثيات يدويًا.',
      3: 'انتهت مهلة تحديد الموقع. حاول مجددًا أو أدخل الإحداثيات يدويًا.'
    };
    setStatus(prayerStatus, messages[error.code] || 'تعذر تحديد الموقع. أدخل الإحداثيات يدويًا.', true);
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
}

function getPrayerTimes(date) {
  var coordinates = new window.adhan.Coordinates(
    prayerLocation.latitude, prayerLocation.longitude
  );
  return new window.adhan.PrayerTimes(coordinates, date, getCalculationParameters());
}

function getPrayerEnum(key) {
  var enumKey = key.charAt(0).toUpperCase() + key.slice(1);
  return window.adhan.Prayer[enumKey];
}

function renderPrayerTimes() {
  var list = document.getElementById('prayerList');
  list.textContent = '';
  prayerKeys.forEach(function (key) {
    var item = document.createElement('div');
    item.className = 'prayer-time';
    item.id = 'prayer-' + key;
    var label = document.createElement('span');
    label.textContent = prayerNames[key];
    var time = document.createElement('time');
    time.id = 'time-' + key;
    time.dir = 'ltr';
    item.appendChild(label);
    item.appendChild(time);
    list.appendChild(item);
  });
}

function updatePrayerTimes(force) {
  document.getElementById('timezoneLabel').textContent = deviceTimezone;
  if (!prayerLocation) {
    document.getElementById('prayerList').textContent = '';
    document.getElementById('prayerDate').textContent =
      'تُحسب المواقيت حسب موقعك والمنطقة الزمنية لجهازك.';
    return;
  }
  var now = new Date();
  var dateKey = localDateKey(now);
  var cacheKey = [dateKey, prayerLocation.latitude, prayerLocation.longitude,
    document.getElementById('calcMethod').value, deviceTimezone].join('|');
  if (force || !prayerTimesCache || prayerTimesCache.key !== cacheKey) {
    try {
      var times = getPrayerTimes(now);
      var dateFormatter = new Intl.DateTimeFormat('ar-EG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: deviceTimezone
      });
      prayerTimesCache = {
        key: cacheKey,
        times: times,
        dateText: dateFormatter.format(now)
      };
      renderPrayerTimes();
    } catch (error) {
      setStatus(prayerStatus, 'تعذر حساب المواقيت. تحقق من الإحداثيات وطريقة الحساب.', true);
      return;
    }
  }
  document.getElementById('prayerDate').textContent =
    prayerTimesCache.dateText + ' · ' + deviceTimezone;
  prayerKeys.forEach(function (key) {
    var time = prayerTimesCache.times.timeForPrayer(getPrayerEnum(key));
    var output = document.getElementById('time-' + key);
    if (time && Number.isFinite(time.getTime())) {
      output.dateTime = time.toISOString();
      output.textContent = formatTime(time);
    } else {
      output.removeAttribute('datetime');
      output.textContent = 'غير متاح';
    }
    document.getElementById('prayer-' + key).classList.remove('next-prayer');
  });
  nextPrayerAt = null;
  for (var i = 0; i < salatKeys.length; i += 1) {
    var key = salatKeys[i];
    var candidate = prayerTimesCache.times.timeForPrayer(getPrayerEnum(key));
    if (candidate && candidate.getTime() > now.getTime()) {
      nextPrayerAt = candidate;
      nextPrayerName = prayerNames[key];
      document.getElementById('prayer-' + key).classList.add('next-prayer');
      break;
    }
  }
  if (!nextPrayerAt) {
    var tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var tomorrowTimes = getPrayerTimes(tomorrow);
    nextPrayerAt = tomorrowTimes.fajr;
    nextPrayerName = prayerNames.fajr;
  }
  updateNextPrayerCountdown();
}

function updateNextPrayerCountdown() {
  if (!nextPrayerAt || !prayerLocation) return;
  var seconds = Math.max(0, Math.floor((nextPrayerAt.getTime() - Date.now()) / 1000));
  var hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  var minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  var remaining = hours + ':' + minutes;
  var nextLabel = document.getElementById('nextPrayerLabel');
  if (nextLabel) {
    nextLabel.textContent = 'الصلاة التالية: ' + nextPrayerName + ' بعد ' + remaining;
    nextLabel.hidden = false;
  }
}

function updateQibla() {
  if (!prayerLocation) {
    document.getElementById('qiblaBearing').textContent = '—°';
    setStatus(compassStatus, 'حدّد موقعك من قسم الصلاة أولًا.');
    return;
  }
  var bearing = window.adhan.Qibla(new window.adhan.Coordinates(
    prayerLocation.latitude, prayerLocation.longitude
  ));
  document.getElementById('qiblaBearing').textContent =
    Math.round(bearing) + '° من الشمال';
  document.getElementById('compassArrow').style.transform =
    'rotate(' + (bearing - (compassHeading || 0)) + 'deg)';
  setStatus(compassStatus, compassHeading === null
    ? 'الاتجاه محسوب من الشمال. شغّل البوصلة لتحريك المؤشر مع جهازك.'
    : 'اتجاه القبلة بالنسبة إلى اتجاه الجهاز.');
}

function handleOrientation(event) {
  var heading = Number.isFinite(event.webkitCompassHeading)
    ? event.webkitCompassHeading
    : event.absolute && Number.isFinite(event.alpha) ? (360 - event.alpha) % 360 : null;
  if (heading === null) return;
  compassHeading = heading;
  updateQibla();
}

function startCompass() {
  if (!window.DeviceOrientationEvent) {
    setStatus(compassStatus, 'مستشعر البوصلة غير متاح في هذا الجهاز. استخدم زاوية القبلة الظاهرة.', true);
    return;
  }
  var requestPermission = window.DeviceOrientationEvent.requestPermission;
  var permission = typeof requestPermission === 'function'
    ? requestPermission.call(window.DeviceOrientationEvent)
    : Promise.resolve('granted');
  permission.then(function (result) {
    if (result !== 'granted') {
      setStatus(compassStatus, 'لم يُسمح باستخدام مستشعر البوصلة. يمكنك استخدام الزاوية الظاهرة.', true);
      return;
    }
    window.addEventListener('deviceorientation', handleOrientation);
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation);
    }
    setStatus(compassStatus, 'حرّك الهاتف ببطء بشكل الرقم 8 لمعايرة البوصلة.');
    window.setTimeout(function () {
      if (compassHeading === null) {
        setStatus(compassStatus, 'لم تصل قراءة من مستشعر البوصلة. جرّب جهازًا يدعم مستشعر الاتجاه.', true);
      }
    }, 5000);
  }).catch(function () {
    setStatus(compassStatus, 'تعذر تشغيل البوصلة. تحقق من إذن مستشعر الاتجاه في الجهاز.', true);
  });
}

var adhkar = {
  morning: [
    { id: 'kursi', text: 'آية الكرسي — الله لا إله إلا هو الحي القيوم، تُقرأ كاملة.', count: 1, reference: 'البقرة: 255' },
    { id: 'muawwidhat', text: 'سورة الإخلاص وسورتا الفلق والناس.', count: 3, reference: 'كل سورة ثلاث مرات' },
    { id: 'asbahna', text: 'أصبحنا وأصبح الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له، له الملك وله الحمد، وهو على كل شيء قدير.', count: 1, reference: 'ذكر الصباح' },
    { id: 'raditu', text: 'رضيت بالله ربًا، وبالإسلام دينًا، وبمحمد ﷺ نبيًا.', count: 3, reference: 'ثلاث مرات' },
    { id: 'bismillah', text: 'بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم.', count: 3, reference: 'ثلاث مرات' },
    { id: 'subhanallah', text: 'سبحان الله وبحمده.', count: 100, reference: 'مئة مرة' }
  ],
  evening: [
    { id: 'kursi', text: 'آية الكرسي — الله لا إله إلا هو الحي القيوم، تُقرأ كاملة.', count: 1, reference: 'البقرة: 255' },
    { id: 'muawwidhat', text: 'سورة الإخلاص وسورتا الفلق والناس.', count: 3, reference: 'كل سورة ثلاث مرات' },
    { id: 'amsayna', text: 'أمسينا وأمسى الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له، له الملك وله الحمد، وهو على كل شيء قدير.', count: 1, reference: 'ذكر المساء' },
    { id: 'raditu', text: 'رضيت بالله ربًا، وبالإسلام دينًا، وبمحمد ﷺ نبيًا.', count: 3, reference: 'ثلاث مرات' },
    { id: 'bismillah', text: 'بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم.', count: 3, reference: 'ثلاث مرات' },
    { id: 'subhanallah', text: 'سبحان الله وبحمده.', count: 100, reference: 'مئة مرة' }
  ]
};

function renderAdhkar() {
  var list = document.getElementById('adhkarList');
  var period = adhkar[currentDhikrPeriod];
  list.textContent = '';
  period.forEach(function (entry) {
    var card = document.createElement('article');
    card.className = 'dhikr';
    var text = document.createElement('p');
    text.textContent = entry.text;
    var footer = document.createElement('div');
    footer.className = 'dhikr-footer';
    var reference = document.createElement('span');
    reference.className = 'dhikr-ref';
    reference.textContent = entry.reference;
    var button = document.createElement('button');
    button.className = 'dhikr-count';
    button.type = 'button';
    var key = 'ahl-athar-dhikr-' + localDateKey(new Date()) + '-' +
      currentDhikrPeriod + '-' + entry.id;
    var count = 0;
    try {
      count = Number(localStorage.getItem(key)) || 0;
    } catch (error) {
      setStatus(prayerStatus, 'تعذر قراءة التقدم المحفوظ للأذكار.', true);
    }
    count = Math.min(count, entry.count);
    button.textContent = count + ' / ' + entry.count;
    button.setAttribute('aria-label', 'سجل قراءة الذكر: ' + entry.text +
      '، ' + count + ' من ' + entry.count);
    button.disabled = count >= entry.count;
    button.addEventListener('click', function () {
      var next = Math.min(entry.count, count + 1);
      if (!saveValue(key, String(next), prayerStatus)) return;
      count = next;
      button.textContent = count + ' / ' + entry.count;
      button.setAttribute('aria-label', 'سجل قراءة الذكر: ' + entry.text +
        '، ' + count + ' من ' + entry.count);
      button.disabled = count >= entry.count;
      if (accountUser && window.ahlAuth && window.ahlAuth.configured) {
        window.ahlAuth.logActivity(accountUser.id, 'dhikr_progress', {
          period: currentDhikrPeriod, item: entry.text.slice(0, 80), count: next
        }).catch(function () {});
      }
    });
    footer.appendChild(reference);
    footer.appendChild(button);
    card.appendChild(text);
    card.appendChild(footer);
    list.appendChild(card);
  });
}

function selectDhikrPeriod(period) {
  currentDhikrPeriod = period;
  ['morning', 'evening'].forEach(function (id) {
    var active = id === period;
    var button = document.getElementById(id === 'morning' ? 'morningBtn' : 'eveningBtn');
    button.className = 'adhkar-choice' + (active ? ' on' : '');
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderAdhkar();
}

function saveAdhanUrl() {
  var input = document.getElementById('adhanUrl');
  var url;
  try {
    url = new URL(input.value.trim());
  } catch (error) {
    setStatus(audioStatus, 'أدخل رابطًا صحيحًا لتسجيل الأذان.', true);
    return;
  }
  if (url.protocol !== 'https:') {
    setStatus(audioStatus, 'لأمان التصفح، يجب أن يبدأ رابط التسجيل بـ https://.', true);
    return;
  }
  if (!saveValue('ahl-athar-adhan-url', url.href, audioStatus)) return;
  var player = document.getElementById('adhanAudio');
  player.src = url.href;
  player.hidden = false;
  player.load();
  setStatus(audioStatus, 'حُفظ الرابط. استخدم مشغّل الصوت لبدء الأذان.');
}

function currentDhikrData() {
  var data = {};
  var today = localDateKey(new Date());
  var prefix = 'ahl-athar-dhikr-' + today + '-';
  try {
    for (var index = 0; index < localStorage.length; index += 1) {
      var key = localStorage.key(index);
      if (!key || key.indexOf(prefix) !== 0) continue;
      var count = Number(localStorage.getItem(key));
      if (Number.isFinite(count) && count > 0) {
        data[key.slice('ahl-athar-dhikr-'.length)] = count;
      }
    }
  } catch (error) {
    setStatus(document.getElementById('syncStatus'),
      'تعذرت قراءة تقدم الأذكار من هذا الجهاز.', true);
  }
  return data;
}

function scheduleAccountSync() {
  if (!accountUser || !window.ahlAuth || !window.ahlAuth.configured) return;
  window.clearTimeout(accountSyncTimer);
  accountSyncTimer = window.setTimeout(function () {
    syncAccountData(accountUser, false);
  }, 600);
}

async function syncAccountData(user, mergeRemote) {
  if (!user || !window.ahlAuth.configured) return;
  var status = document.getElementById('syncStatus');
  setStatus(status, 'جاري مزامنة الأذكار وطريقة الحساب…');
  try {
    var remote = await window.ahlAuth.loadUserData(user.id);
    var remoteData = remote && remote.data && typeof remote.data === 'object'
      ? remote.data
      : {};
    var methodValues = ['auto', 'egypt', 'umm', 'mwl'];
    if (mergeRemote && methodValues.indexOf(remoteData.calculationMethod) !== -1) {
      document.getElementById('calcMethod').value = remoteData.calculationMethod;
      localStorage.setItem('ahl-athar-calculation-method', remoteData.calculationMethod);
      prayerTimesCache = null;
      updatePrayerTimes(true);
    }
    if (mergeRemote && ['shafi', 'hanafi'].indexOf(remoteData.asrMadhab) !== -1) {
      document.getElementById('asrMadhab').value = remoteData.asrMadhab;
      localStorage.setItem('ahl-athar-asr-madhab', remoteData.asrMadhab);
      prayerTimesCache = null;
      updatePrayerTimes(true);
    }

    var localDhikr = currentDhikrData();
    var remoteDhikr = remoteData.dhikr &&
      typeof remoteData.dhikr === 'object' && !Array.isArray(remoteData.dhikr)
      ? remoteData.dhikr
      : {};
    var todayPrefix = localDateKey(new Date()) + '-';
    Object.keys(remoteDhikr).forEach(function (key) {
      if (key.indexOf(todayPrefix) !== 0) return;
      var remoteCount = Number(remoteDhikr[key]);
      var localCount = Number(localDhikr[key]) || 0;
      if (!Number.isFinite(remoteCount) || remoteCount < 0) return;
      var mergedCount = Math.max(localCount, remoteCount);
      localDhikr[key] = mergedCount;
      localStorage.setItem('ahl-athar-dhikr-' + key, String(mergedCount));
    });

    await window.ahlAuth.saveUserData(user.id, {
      version: 1,
      calculationMethod: document.getElementById('calcMethod').value,
      asrMadhab: document.getElementById('asrMadhab').value,
      dhikr: currentDhikrData()
    });
    renderAdhkar();
    setStatus(status, 'تمت المزامنة. الموقع الدقيق محفوظ على هذا الجهاز فقط.');
  } catch (error) {
    setStatus(status, 'تعذرت المزامنة: ' + error.message, true);
  }
}

function setAccountState(state) {
  var configMissing = document.getElementById('authConfigMissing');
  var form = document.getElementById('authForm');
  var signedIn = document.getElementById('accountSignedIn');
  var message = document.getElementById('authMessage');
  if (!state.configured) {
    accountUser = null;
    activeSyncUserId = null;
    configMissing.hidden = false;
    document.getElementById('googleSignInBtn').hidden = true;
    form.hidden = true;
    signedIn.hidden = true;
    setStatus(message, 'أضف إعدادات Supabase لتفعيل الحسابات.');
    return;
  }
  configMissing.hidden = true;
  document.getElementById('googleSignInBtn').hidden = Boolean(state.user);
  accountUser = state.user;
  if (!state.user) {
    activeSyncUserId = null;
    form.hidden = false;
    signedIn.hidden = true;
    setStatus(message, 'سجّل الدخول أو أنشئ حسابًا بالبريد الإلكتروني.');
    return;
  }
  form.hidden = true;
  signedIn.hidden = false;
  document.getElementById('accountEmail').textContent = state.user.email || '';
  setStatus(message, 'تسجيل الدخول محفوظ تلقائيًا على هذا الجهاز.');
  if (state.event === 'SIGNED_IN' || state.event === 'INITIAL_SESSION') {
    window.ahlAuth.saveMemberProfile(state.user).then(function () {
      if (state.event !== 'SIGNED_IN') return;
      return window.ahlAuth.logActivity(state.user.id, 'login', {
        provider: state.user.app_metadata && state.user.app_metadata.provider || 'email'
      });
    }).catch(function (error) {
      setStatus(message, 'تم الدخول، لكن تعذر تحديث سجل الحساب: ' + error.message, true);
    });
  }
  if (activeSyncUserId !== state.user.id) {
    activeSyncUserId = state.user.id;
    window.setTimeout(function () {
      syncAccountData(state.user, true);
    }, 0);
  }
}

function setAuthBusy(busy) {
  document.getElementById('signInBtn').disabled = busy;
  document.getElementById('signUpBtn').disabled = busy;
  document.getElementById('googleSignInBtn').disabled = busy;
}

function handleGoogleSignIn() {
  setAuthBusy(true);
  setStatus(document.getElementById('authMessage'), 'جاري تحويلك إلى Google لتسجيل الدخول…');
  window.ahlAuth.signInWithGoogle().then(function (result) {
    if (result.error) throw result.error;
  }).catch(function (error) {
    setStatus(document.getElementById('authMessage'), 'تعذر تسجيل الدخول بحساب Google: ' + error.message, true);
    setAuthBusy(false);
  });
}

function handleSignIn(event) {
  event.preventDefault();
  var form = document.getElementById('authForm');
  if (!form.reportValidity()) return;
  var email = document.getElementById('authEmail').value.trim();
  var password = document.getElementById('authPassword').value;
  setAuthBusy(true);
  setStatus(document.getElementById('authMessage'), 'جاري تسجيل الدخول…');
  window.ahlAuth.signIn(email, password).then(function (result) {
    if (result.error) throw result.error;
    setStatus(document.getElementById('authMessage'), 'تم تسجيل الدخول.');
  }).catch(function (error) {
    setStatus(document.getElementById('authMessage'),
      'تعذر تسجيل الدخول: ' + error.message, true);
  }).finally(function () {
    setAuthBusy(false);
  });
}

function handleSignUp() {
  var form = document.getElementById('authForm');
  if (!form.reportValidity()) return;
  var email = document.getElementById('authEmail').value.trim();
  var password = document.getElementById('authPassword').value;
  setAuthBusy(true);
  setStatus(document.getElementById('authMessage'), 'جاري إنشاء الحساب…');
  window.ahlAuth.signUp(email, password).then(function (result) {
    if (result.error) throw result.error;
    if (result.data.session) {
      setStatus(document.getElementById('authMessage'), 'تم إنشاء الحساب وتسجيل الدخول.');
    } else {
      setStatus(document.getElementById('authMessage'),
        'تم إنشاء الحساب. افتح رسالة البريد لتأكيد العنوان ثم سجّل الدخول.');
    }
  }).catch(function (error) {
    setStatus(document.getElementById('authMessage'),
      'تعذر إنشاء الحساب: ' + error.message, true);
  }).finally(function () {
    setAuthBusy(false);
  });
}

function initAuth() {
  if (!window.ahlAuth) {
    setStatus(document.getElementById('authMessage'),
      'تعذر تحميل مكتبة تسجيل الدخول.', true);
    return;
  }
  window.ahlAuth.init(setAccountState);
  document.getElementById('authForm').addEventListener('submit', handleSignIn);
  document.getElementById('signUpBtn').addEventListener('click', handleSignUp);
  document.getElementById('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
  document.getElementById('signOutBtn').addEventListener('click', function () {
    setStatus(document.getElementById('authMessage'), 'جاري تسجيل الخروج…');
    window.ahlAuth.signOut().then(function (result) {
      if (result.error) throw result.error;
      setStatus(document.getElementById('authMessage'), 'تم تسجيل الخروج.');
    }).catch(function (error) {
      setStatus(document.getElementById('authMessage'),
        'تعذر تسجيل الخروج: ' + error.message, true);
    });
  });
}

function loadSavedSettings() {
  prayerLocation = loadPosition();
  if (prayerLocation) {
    document.getElementById('latitude').value = prayerLocation.latitude;
    document.getElementById('longitude').value = prayerLocation.longitude;
    updateLocationStatus('الموقع محفوظ على هذا الجهاز');
  }
  try {
    var method = localStorage.getItem('ahl-athar-calculation-method');
    if (['auto', 'egypt', 'umm', 'mwl'].indexOf(method) !== -1) {
      document.getElementById('calcMethod').value = method;
    }
    var madhab = localStorage.getItem('ahl-athar-asr-madhab');
    if (['shafi', 'hanafi'].indexOf(madhab) !== -1) {
      document.getElementById('asrMadhab').value = madhab;
    }
    var adhanUrl = localStorage.getItem('ahl-athar-adhan-url');
    if (adhanUrl) {
      document.getElementById('adhanUrl').value = adhanUrl;
      document.getElementById('adhanAudio').src = adhanUrl;
      document.getElementById('adhanAudio').hidden = false;
    }
  } catch (error) {
    setStatus(prayerStatus, 'تعذر قراءة بعض الإعدادات المحفوظة.', true);
  }
  document.getElementById('timezoneLabel').textContent = deviceTimezone;
  updatePrayerTimes(true);
  updateQibla();
}

function copyQ() {
  var value = document.getElementById('qt').value;
  if (!value) {
    document.getElementById('qm').textContent = 'اكتب سؤالك أولًا.';
    return;
  }
  if (!navigator.clipboard) {
    document.getElementById('qm').textContent = 'النسخ غير متاح في هذا المتصفح.';
    return;
  }
  navigator.clipboard.writeText(value).then(function () {
    document.getElementById('qm').textContent = 'تم نسخ السؤال.';
  }).catch(function () {
    document.getElementById('qm').textContent = 'تعذر نسخ السؤال. تحقق من إذن الحافظة.';
  });
}

async function sendQuestion() {
  var question = document.getElementById('qt').value.trim();
  var consent = document.getElementById('questionConsent').checked;
  var button = document.getElementById('sendQuestionBtn');
  var status = document.getElementById('qm');
  var draftBox = document.getElementById('questionDraft');

  if (question.length < 5 || question.length > 1600) {
    setStatus(status, 'اكتب سؤالًا بين 5 و1600 حرف.', true);
    return;
  }
  if (!consent) {
    setStatus(status, 'وافق على إرسال السؤال إلى Gemini وGrok وTelegram أولًا.', true);
    return;
  }

  button.disabled = true;
  draftBox.hidden = true;
  setStatus(status, 'جارٍ إرسال السؤال إلى Gemini وGrok معًا، ثم إرسالهما للمراجعة…');
  try {
    var response = await fetch(apiUrl('/api/questions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ question: question })
    });
    var result;
    try {
      var responseText = new TextDecoder('utf-8', { fatal: true })
        .decode(await response.arrayBuffer());
      result = JSON.parse(responseText);
    } catch (error) {
      throw new Error('استجابة الخادم غير صالحة. حاول لاحقًا.');
    }

    if (typeof result.geminiDraft === 'string' && typeof result.grokDraft === 'string') {
      document.getElementById('questionGeminiDraftText').textContent = result.geminiDraft;
      document.getElementById('questionGrokDraftText').textContent = result.grokDraft;
      draftBox.hidden = false;
    }
    if (!response.ok) throw new Error(result.error || 'تعذر إرسال السؤال. حاول لاحقًا.');
    setStatus(status, 'وصل السؤال وإجابتا Gemini وGrok إلى Telegram للمراجعة. الإجابتان مسودتان وليستا فتوى معتمدة.');
  } catch (error) {
    var message = error instanceof TypeError
      ? 'تعذر الاتصال بالخادم الخلفي. تأكد من تشغيل الخادم ثم حاول مجددًا.'
      : error.message;
    setStatus(status, message || 'تعذر إرسال السؤال. حاول لاحقًا.', true);
  } finally {
    button.disabled = false;
  }
}

function share() {
  var url = location.href;
  if (navigator.share) {
    navigator.share({ title: 'استراحة أهل الأثر', url: url }).catch(function (error) {
      if (error.name !== 'AbortError') setStatus(prayerStatus, 'تعذرت مشاركة التطبيق.', true);
    });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function () {
      setStatus(prayerStatus, 'تم نسخ رابط التطبيق.');
    }).catch(function () {
      setStatus(prayerStatus, 'تعذر نسخ رابط التطبيق.', true);
    });
  } else {
    setStatus(prayerStatus, 'المشاركة غير مدعومة في هذا المتصفح.', true);
  }
}

var installPrompt = null;
window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  installPrompt = event;
  document.getElementById('inst').hidden = false;
});

function install() {
  if (!installPrompt) return;
  installPrompt.prompt();
  installPrompt.userChoice.then(function () {
    installPrompt = null;
    document.getElementById('inst').hidden = true;
  });
}

document.getElementById('calcMethod').addEventListener('change', function () {
  saveValue('ahl-athar-calculation-method', this.value, prayerStatus);
  prayerTimesCache = null;
  updatePrayerTimes(true);
});
document.getElementById('asrMadhab').addEventListener('change', function () {
  saveValue('ahl-athar-asr-madhab', this.value, prayerStatus);
  prayerTimesCache = null;
  updatePrayerTimes(true);
});
document.getElementById('saveLocation').addEventListener('click', saveLocation);
document.getElementById('locateBtn').addEventListener('click', locateUser);
document.getElementById('qiblaLocateBtn').addEventListener('click', locateUser);
document.getElementById('compassBtn').addEventListener('click', startCompass);
document.getElementById('saveAdhan').addEventListener('click', saveAdhanUrl);
document.getElementById('questionConsent').addEventListener('change', function () {
  document.getElementById('sendQuestionBtn').disabled = !this.checked;
});
document.getElementById('sendQuestionBtn').addEventListener('click', sendQuestion);
document.getElementById('mediaFilters').addEventListener('click', function (event) {
  var button = event.target.closest('[data-media-category]');
  if (!button) return;
  activeMediaCategory = button.getAttribute('data-media-category');
  document.querySelectorAll('[data-media-category]').forEach(function (filter) {
    var active = filter === button;
    filter.classList.toggle('on', active);
    filter.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderMediaLibrary();
});
document.getElementById('morningBtn').addEventListener('click', function () {
  selectDhikrPeriod('morning');
});
document.getElementById('eveningBtn').addEventListener('click', function () {
  selectDhikrPeriod('evening');
});
document.getElementById('adhanAudio').addEventListener('error', function () {
  setStatus(audioStatus, 'تعذر تحميل التسجيل. تحقق من الرابط المباشر وإتاحة الملف.', true);
});
document.getElementById('adhanAudio').addEventListener('play', function () {
  setStatus(audioStatus, 'يُشغّل التسجيل الآن.');
});
document.getElementById('adhanAudio').addEventListener('ended', function () {
  setStatus(audioStatus, 'انتهى التسجيل.');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function () {
    setStatus(prayerStatus, 'تعذر تفعيل الاستخدام دون اتصال في هذا المتصفح.', true);
  });
}

buildSchedule();
updateLessonCountdown();
loadSavedSettings();
renderAdhkar();
initAuth();
setInterval(updateLessonCountdown, 1000);
setInterval(function () { updatePrayerTimes(false); }, 60000);
setInterval(updateNextPrayerCountdown, 1000);
