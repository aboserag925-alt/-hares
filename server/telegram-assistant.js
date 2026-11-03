'use strict';

const WINDOW_MS = 15 * 60 * 1000;
const USER_LIMIT = 5;
const MAX_MESSAGE_LENGTH = 1200;

function createTelegramAssistant(options) {
  options = options || {};
  const env = options.env || process.env;
  const fetchImpl = options.fetch || global.fetch;
  const token = env.TELEGRAM_BOT_TOKEN;
  const reviewChatId = env.TELEGRAM_CHAT_ID;
  const siteUrl = (env.SITE_URL || 'https://aboserag925-alt.github.io/Haress/').replace(/\/$/, '') + '/';
  const limits = new Map();

  async function call(method, payload) {
    if (!token) throw new Error('Telegram bot token is not configured.');
    const response = await fetchImpl('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Telegram API request failed: ' + method);
    return result.result;
  }

  function limited(userId) {
    const now = Date.now();
    let entry = limits.get(String(userId));
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      limits.set(String(userId), entry);
    }
    if (limits.size > 5000) {
      for (const [key, value] of limits) if (value.resetAt <= now) limits.delete(key);
    }
    if (entry.count >= USER_LIMIT) return true;
    entry.count += 1;
    return false;
  }

  async function send(chatId, text, keyboard) {
    const payload = { chat_id: chatId, text: text, disable_web_page_preview: true };
    if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
    await call('sendMessage', payload);
  }

  function mainMenu() {
    return [
      [{ text: '🌐 فتح منصة استراحة أهل الأثر', url: siteUrl }],
      [{ text: '📚 المكتبة والمحاضرات', callback_data: 'haress:library' }],
      [{ text: '🗓️ الجدول والمواعيد', callback_data: 'haress:schedule' }],
      [{ text: '✉️ إرسال سؤال للمراجعة', callback_data: 'haress:question' }],
      [{ text: 'ℹ️ المساعدة والخصوصية', callback_data: 'haress:help' }]
    ];
  }

  async function answerCallback(callback) {
    const data = String(callback.data || '');
    await call('answerCallbackQuery', { callback_query_id: callback.id });
    if (!callback.message || !callback.message.chat || callback.message.chat.type !== 'private') return;
    const chatId = callback.message.chat.id;
    if (data === 'haress:library') {
      await send(chatId, 'المكتبة المعتمدة متاحة من داخل المنصة. لا يعرض البوت ملفات قيد المراجعة أو مواد غير معتمدة.', [
        [{ text: 'فتح المنصة', url: siteUrl }]
      ]);
    } else if (data === 'haress:schedule') {
      await send(chatId, 'يمكنك متابعة المحاضرات والمواعيد المنشورة من قسم الجدول في المنصة. ستظهر المواعيد المعتمدة فقط.', [
        [{ text: 'فتح الجدول', url: siteUrl + '#schedule' }]
      ]);
    } else if (data === 'haress:question') {
      await send(chatId, 'اكتب سؤالك في رسالة واحدة هنا، وسأرسله للمراجعة البشرية. لن أقدّم فتوى آلية أو أصف أي مسودة بأنها جواب معتمد.');
    } else if (data === 'haress:help') {
      await send(chatId, 'الأوامر المتاحة:\n/start أو /menu — القائمة الرئيسية\n/help — المساعدة\n/stop — إيقاف استقبال رسائلك هنا\n\nنستخدم رسالتك فقط لإحالتها إلى فريق المراجعة عند إرسال سؤال. لا ترسل كلمات مرور أو بيانات مالية أو معلومات خاصة.');
    } else {
      await send(chatId, 'اختر أحد أقسام القائمة.', mainMenu());
    }
  }

  async function handleMessage(message) {
    if (!message || !message.chat || message.chat.type !== 'private' || !message.from || message.from.is_bot) return false;
    const chatId = message.chat.id;
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text) || /^\/menu(?:@\w+)?$/i.test(text)) {
      await send(chatId, 'مرحبًا بك في المساعد الرسمي لمنصة استراحة أهل الأثر. كيف أستطيع مساعدتك؟', mainMenu());
      return true;
    }
    if (/^\/help(?:@\w+)?$/i.test(text)) {
      await send(chatId, 'أرسل /menu لعرض الأقسام. يمكنك إرسال سؤال ليصل إلى فريق المراجعة البشرية. لا يقدّم البوت فتاوى مستقلة ولا يعرض مواد غير معتمدة.');
      return true;
    }
    if (/^\/stop(?:@\w+)?$/i.test(text)) {
      await send(chatId, 'تم إيقاف معالجة الرسائل العادية في هذه المحادثة. لن تُرسل رسائلك التالية للمراجعة. لإعادة الاستخدام أرسل /start.');
      return true;
    }
    if (!text) {
      await send(chatId, 'أستقبل الرسائل النصية فقط حاليًا. أرسل /menu للمساعدة.');
      return true;
    }
    if (text.length < 5 || text.length > MAX_MESSAGE_LENGTH) {
      await send(chatId, 'اجعل رسالتك بين 5 و1200 حرف.');
      return true;
    }
    if (limited(message.from.id)) {
      await send(chatId, 'وصلت إلى الحد المؤقت للرسائل (5 رسائل كل 15 دقيقة). حاول لاحقًا.');
      return true;
    }
    if (!reviewChatId) {
      await send(chatId, 'استقبال الأسئلة غير متاح مؤقتًا. يمكنك استخدام المنصة مباشرة.');
      return true;
    }
    const sender = [message.from.first_name, message.from.last_name].filter(Boolean).join(' ').slice(0, 80) || 'مستخدم Telegram';
    await call('sendMessage', {
      chat_id: reviewChatId,
      text: 'رسالة جديدة من مساعد استراحة أهل الأثر للمراجعة البشرية\nالاسم الظاهر: ' + sender +
        '\nTelegram ID: ' + String(message.from.id) + '\n\nالرسالة:\n' + text
    });
    await send(chatId, 'وصلت رسالتك إلى فريق المراجعة بنجاح. سيُراجعها المختصون، ولا يُعد هذا الإشعار فتوى أو إجابة شرعية.');
    return true;
  }

  async function processUpdate(update) {
    if (update && update.callback_query && String(update.callback_query.data || '').startsWith('haress:')) {
      await answerCallback(update.callback_query);
      return true;
    }
    if (update && update.message) return handleMessage(update.message);
    return false;
  }

  return { processUpdate: processUpdate };
}

module.exports = { createTelegramAssistant: createTelegramAssistant };
