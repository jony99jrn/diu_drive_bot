const API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

export async function tg(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram ${method} failed:`, data.description);
    return null;
  }
  return data.result;
}

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const sendMessage = (chat_id, text, extra = {}) =>
  tg('sendMessage', {
    chat_id,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });

export const editMessage = (chat_id, message_id, text, extra = {}) =>
  tg('editMessageText', {
    chat_id,
    message_id,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });

export const answerCb = (callback_query_id, text = '', show_alert = false) =>
  tg('answerCallbackQuery', { callback_query_id, text, show_alert });

const SEND = {
  document: ['sendDocument', 'document'],
  photo: ['sendPhoto', 'photo'],
  video: ['sendVideo', 'video'],
  audio: ['sendAudio', 'audio'],
};

export function sendFile(chat_id, kind, file_id, caption = '') {
  const [method, field] = SEND[kind] || SEND.document;
  return tg(method, { chat_id, [field]: file_id, caption, parse_mode: 'HTML' });
}

export const copyMessage = (chat_id, from_chat_id, message_id, caption) =>
  tg('copyMessage', { chat_id, from_chat_id, message_id, caption });
