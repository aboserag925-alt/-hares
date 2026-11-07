'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_LIBRARY_ITEMS = 500;
const CATEGORY_NAMES = {
  audio: 'صوتيات',
  video: 'فيديو',
  books: 'كتب',
  images: 'صور',
  other: 'مواد أخرى'
};
const TYPES = {
  '.aac': { mimeType: 'audio/aac', kind: 'audio', category: 'audio' },
  '.epub': { mimeType: 'application/epub+zip', kind: 'document', category: 'books' },
  '.flac': { mimeType: 'audio/flac', kind: 'audio', category: 'audio' },
  '.jpeg': { mimeType: 'image/jpeg', kind: 'image', category: 'images' },
  '.jpg': { mimeType: 'image/jpeg', kind: 'image', category: 'images' },
  '.m4a': { mimeType: 'audio/mp4', kind: 'audio', category: 'audio' },
  '.m4v': { mimeType: 'video/mp4', kind: 'video', category: 'video' },
  '.mp3': { mimeType: 'audio/mpeg', kind: 'audio', category: 'audio' },
  '.mp4': { mimeType: 'video/mp4', kind: 'video', category: 'video' },
  '.oga': { mimeType: 'audio/ogg', kind: 'audio', category: 'audio' },
  '.ogg': { mimeType: 'audio/ogg', kind: 'audio', category: 'audio' },
  '.opus': { mimeType: 'audio/ogg', kind: 'audio', category: 'audio' },
  '.pdf': { mimeType: 'application/pdf', kind: 'document', category: 'books' },
  '.png': { mimeType: 'image/png', kind: 'image', category: 'images' },
  '.txt': { mimeType: 'text/plain', kind: 'document', category: 'books' },
  '.wav': { mimeType: 'audio/wav', kind: 'audio', category: 'audio' },
  '.webm': { mimeType: 'video/webm', kind: 'video', category: 'video' },
  '.webp': { mimeType: 'image/webp', kind: 'image', category: 'images' }
};

function categoryFromCaption(caption, fallback) {
  if (/(?:^|\s)#(?:صوتيات|صوت|audio)(?=$|\s)/iu.test(caption)) return 'audio';
  if (/(?:^|\s)#(?:فيديو|مرئي|video)(?=$|\s)/iu.test(caption)) return 'video';
  if (/(?:^|\s)#(?:كتب|كتاب|books?)(?=$|\s)/iu.test(caption)) return 'books';
  if (/(?:^|\s)#(?:صور|image|photos?)(?=$|\s)/iu.test(caption)) return 'images';
  if (/(?:^|\s)#(?:أخرى|اخرى|other)(?=$|\s)/iu.test(caption)) return 'other';
  return fallback;
}

function cleanTitle(caption, fileName) {
  const withoutTags = caption
    .replace(/#[\p{L}\d_]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback = path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ').trim();
  return (withoutTags || fallback || 'ملف من المجموعة').slice(0, 120);
}

function getAttachment(message) {
  const file = message.document || message.audio || message.video || message.voice ||
    message.video_note || message.animation ||
    (message.photo && message.photo[message.photo.length - 1]);
  if (!file) return null;

  const hintedExtension = file.file_name ? path.extname(file.file_name).toLowerCase() : '';
  const extension = hintedExtension ||
    (message.voice ? '.ogg' : message.video_note ? '.mp4' : message.photo ? '.jpg' : '') || ({
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm'
  }[file.mime_type] || '');
  const type = TYPES[extension];
  if (!type || !file.file_id || !file.file_unique_id) return null;
  const fileName = (file.file_name || ('telegram-file' + extension))
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 180) || ('telegram-file' + extension);
  return {
    file: file,
    extension: extension,
    fileName: fileName,
    mimeType: type.mimeType,
    kind: type.kind,
    defaultCategory: type.category
  };
}

function createMediaLibrary(options) {
  options = options || {};
  const env = options.env || process.env;
  const fetchImpl = options.fetch || global.fetch;
  const storageDirectory = path.resolve(options.storageDirectory || path.join(__dirname, '..', 'storage'));
  const filesDirectory = path.join(storageDirectory, 'media');
  const indexPath = path.join(storageDirectory, 'media-index.json');
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const mediaGroupId = env.TELEGRAM_MEDIA_GROUP_ID || env.TELEGRAM_CHAT_ID;
  let items = [];
  let offset = null;
  let initialized = false;
  let running = false;
  let pollPromise = null;

  async function initialize() {
    if (initialized) return;
    await fs.mkdir(filesDirectory, { recursive: true });
    try {
      const contents = await fs.readFile(indexPath, 'utf8');
      const stored = JSON.parse(contents);
      if (!stored || !Array.isArray(stored.items) ||
          (stored.offset !== null && !Number.isSafeInteger(stored.offset))) {
        throw new Error('Invalid media library index.');
      }
      items = stored.items;
      offset = stored.offset;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await save();
    }
    initialized = true;
  }

  async function save() {
    await fs.mkdir(storageDirectory, { recursive: true });
    const temporaryPath = indexPath + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temporaryPath, JSON.stringify({ offset: offset, items: items }), 'utf8');
    await fs.rename(temporaryPath, indexPath);
  }

  async function telegram(method, payload) {
    const response = await fetchImpl('https://api.telegram.org/bot' + botToken + '/' + method, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json; charset=utf-8'
      },
      signal: AbortSignal.timeout(method === 'getUpdates' ? 35000 : 15000),
      body: JSON.stringify(payload)
    });
    let result;
    try {
      result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer()));
    } catch {
      throw new Error('Telegram returned an invalid response.');
    }
    if (!response.ok || !result.ok) {
      throw new Error('Telegram API request failed for ' + method + '.');
    }
    return result.result;
  }

  async function sendReviewMessage(item) {
    const message = 'ملف جديد للمراجعة قبل نشره في المنصة:\n' +
      'العنوان: ' + item.title + '\n' +
      'التصنيف: ' + CATEGORY_NAMES[item.category] + '\n' +
      'النوع: ' + item.fileName;
    await telegram('sendMessage', {
      chat_id: mediaGroupId,
      text: message,
      reply_markup: {
        inline_keyboard: [[
          { text: 'اعتماد ونشر', callback_data: 'media:approve:' + item.id },
          { text: 'رفض', callback_data: 'media:reject:' + item.id }
        ]]
      }
    });
  }

  async function receiveFile(message) {
    const attachment = getAttachment(message);
    if (!attachment) return;
    if (items.filter(function (item) { return item.status === 'approved' || item.status === 'pending'; }).length >= MAX_LIBRARY_ITEMS) {
      await telegram('sendMessage', {
        chat_id: mediaGroupId,
        text: 'لم يُحفظ الملف؛ وصلت المكتبة إلى الحد المسموح. احذف بعض المواد أولًا.'
      });
      return;
    }
    if (attachment.file.file_size > MAX_FILE_BYTES) {
      await telegram('sendMessage', {
        chat_id: mediaGroupId,
        text: 'لم يُحفظ الملف؛ الحد الأقصى لحجم الملف هو 20 ميجابايت.'
      });
      return;
    }
    if (items.some(function (item) {
      return item.status !== 'removed' && item.fileUniqueId === attachment.file.file_unique_id;
    })) {
      return;
    }

    const fileInfo = await telegram('getFile', { file_id: attachment.file.file_id });
    if (!fileInfo.file_path || fileInfo.file_path.split('/').some(function (segment) {
      return !/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..';
    })) {
      throw new Error('Telegram returned an invalid file path.');
    }
    const downloadUrl = 'https://api.telegram.org/file/bot' + botToken + '/' +
      fileInfo.file_path.split('/').map(function (segment) {
        return encodeURIComponent(segment);
      }).join('/');
    const download = await fetchImpl(downloadUrl, { signal: AbortSignal.timeout(30000) });
    if (!download.ok) throw new Error('Telegram file download failed.');
    const data = Buffer.from(await download.arrayBuffer());
    if (data.length === 0 || data.length > MAX_FILE_BYTES) {
      throw new Error('Telegram file size is outside the allowed limit.');
    }

    const id = randomUUID();
    const storedName = id + attachment.extension;
    const storedPath = path.join(filesDirectory, storedName);
    await fs.writeFile(storedPath, data, { flag: 'wx' });
    const caption = typeof message.caption === 'string' ? message.caption : '';
    const item = {
      id: id,
      storedName: storedName,
      fileName: path.basename(attachment.fileName).slice(0, 180),
      fileUniqueId: attachment.file.file_unique_id,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
      category: categoryFromCaption(caption, attachment.defaultCategory),
      title: cleanTitle(caption, attachment.fileName),
      status: 'pending',
      uploadedAt: new Date((message.date || Date.now() / 1000) * 1000).toISOString()
    };
    items.push(item);
    try {
      await save();
    } catch (error) {
      items = items.filter(function (candidate) { return candidate.id !== id; });
      await fs.rm(storedPath, { force: true });
      throw error;
    }
    try {
      await sendReviewMessage(item);
    } catch (error) {
      items = items.filter(function (candidate) { return candidate.id !== id; });
      await save();
      await fs.rm(storedPath, { force: true });
      throw error;
    }
  }

  async function isGroupAdministrator(userId) {
    if (!userId) return false;
    const member = await telegram('getChatMember', {
      chat_id: mediaGroupId,
      user_id: userId
    });
    return member && ['creator', 'administrator'].includes(member.status);
  }

  async function removeApprovedMedia(message) {
    const match = typeof message.text === 'string' &&
      message.text.match(/^\/media-remove(?:@\w+)?\s+([0-9a-f-]{36})\s*$/i);
    if (!match) return false;
    if (!await isGroupAdministrator(message.from && message.from.id)) {
      await telegram('sendMessage', {
        chat_id: mediaGroupId,
        text: 'حذف مواد المكتبة متاح لمشرفي المجموعة فقط.'
      });
      return true;
    }

    const item = items.find(function (candidate) {
      return candidate.id === match[1] && candidate.status === 'approved';
    });
    if (!item) {
      await telegram('sendMessage', {
        chat_id: mediaGroupId,
        text: 'المادة غير موجودة أو سبق حذفها.'
      });
      return true;
    }

    const previousStatus = item.status;
    item.status = 'removed';
    item.removedAt = new Date().toISOString();
    try {
      await save();
    } catch (error) {
      item.status = previousStatus;
      delete item.removedAt;
      throw error;
    }
    await fs.rm(path.join(filesDirectory, item.storedName), { force: true });
    await telegram('sendMessage', {
      chat_id: mediaGroupId,
      text: 'حُذفت المادة من مكتبة المنصة: ' + item.title
    });
    return true;
  }

  async function processCallback(callback) {
    const match = typeof callback.data === 'string' && callback.data.match(/^media:(approve|reject):([0-9a-f-]{36})$/i);
    const groupId = mediaGroupId;
    if (!match || !callback.message || String(callback.message.chat.id) !== String(groupId)) {
      await telegram('answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'الطلب غير صالح.'
      });
      return;
    }

    if (!await isGroupAdministrator(callback.from && callback.from.id)) {
      await telegram('answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'اعتماد الملفات متاح لمشرفي المجموعة فقط.',
        show_alert: true
      });
      return;
    }

    const item = items.find(function (candidate) {
      return candidate.id === match[2] && candidate.status === 'pending';
    });
    if (!item) {
      await telegram('answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'تمت معالجة الملف أو لم يعد موجودًا.'
      });
      return;
    }

    const approved = match[1] === 'approve';
    item.status = approved ? 'approved' : 'rejected';
    item.reviewedAt = new Date().toISOString();
    try {
      await save();
    } catch (error) {
      item.status = 'pending';
      delete item.reviewedAt;
      throw error;
    }
    if (!approved) {
      await fs.rm(path.join(filesDirectory, item.storedName), { force: true });
    }
    try {
      await telegram('answerCallbackQuery', {
        callback_query_id: callback.id,
        text: approved ? 'تم اعتماد الملف ونشره.' : 'تم رفض الملف.'
      });
      await telegram('editMessageText', {
        chat_id: groupId,
        message_id: callback.message.message_id,
        text: (approved
          ? 'تم اعتماد ونشر الملف: ' + item.title + '\nللحذف لاحقًا استخدم /media-remove ' + item.id
          : 'تم رفض الملف: ' + item.title)
      });
    } catch (error) {
      console.error('Telegram media review notification failed: ' + error.message);
    }
  }

  async function processUpdate(update) {
    await initialize();
    const message = update.message;
    if (message && String(message.chat.id) === String(mediaGroupId)) {
      if (await removeApprovedMedia(message)) return;
      await receiveFile(message);
      return;
    }
    if (update.callback_query) await processCallback(update.callback_query);
  }

  async function pollLoop() {
    while (running) {
      try {
        const updates = await telegram('getUpdates', {
          offset: offset === null ? undefined : offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query']
        });
        for (const update of updates) {
          if (!running) break;
          await processUpdate(update);
          offset = update.update_id + 1;
          await save();
        }
      } catch (error) {
        console.error('Telegram media polling failed: ' + error.message);
        await new Promise(function (resolve) { setTimeout(resolve, 5000); });
      }
    }
  }

  async function start() {
    if (env.TELEGRAM_MEDIA_ENABLED !== 'true') return;
    if (!botToken || !mediaGroupId) {
      throw new Error('Telegram media requires a bot token and a group ID.');
    }
    await initialize();
    running = true;
    pollPromise = pollLoop();
  }

  async function stop() {
    running = false;
    if (pollPromise) await pollPromise;
  }

  async function listApproved() {
    await initialize();
    return items.filter(function (item) {
      return item.status === 'approved';
    }).sort(function (left, right) {
      return right.uploadedAt.localeCompare(left.uploadedAt);
    }).map(function (item) {
      return {
        id: item.id,
        title: item.title,
        category: item.category,
        categoryName: CATEGORY_NAMES[item.category] || CATEGORY_NAMES.other,
        kind: item.kind,
        mimeType: item.mimeType,
        fileName: item.fileName,
        uploadedAt: item.uploadedAt,
        url: '/api/library/files/' + item.id
      };
    });
  }

  async function getApprovedFile(id) {
    await initialize();
    const item = items.find(function (candidate) {
      return candidate.id === id && candidate.status === 'approved';
    });
    if (!item) return null;
    const filePath = path.join(filesDirectory, item.storedName);
    return { item: item, data: await fs.readFile(filePath) };
  }

  return {
    getApprovedFile: getApprovedFile,
    listApproved: listApproved,
    processUpdate: processUpdate,
    start: start,
    stop: stop
  };
}

module.exports = {
  CATEGORY_NAMES: CATEGORY_NAMES,
  createMediaLibrary: createMediaLibrary
};
