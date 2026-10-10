import { sendMessage, editMessage, answerCb, sendFile, copyMessage, esc } from '../lib/telegram.js';
import {
  getFiles,
  getArchiveDepts,
  addFile,
  getPending,
  setPending,
  clearPending,
  addPending,
  listPending,
  getReportUsage,
  addReport,
  logReport,
} from '../lib/sheets.js';
import {
  ADMIN_IDS,
  CHANNEL_ID,
  isAdmin,
  parseCaption,
  normExam,
  normDept,
  normSemester,
  normCourse,
  normTitle,
  semSort,
  categoryOf,
  extractFile,
  baseName,
  CAT_ICON,
  CAT_ORDER,
  chunk,
  unique,
} from '../lib/util.js';

/* ================= texts ================= */

const HOW_TO = `<b>How to use it</b>
1️⃣ Choose your department
2️⃣ Choose the semester (e.g. Summer 2026)
3️⃣ Choose your course (e.g. CSE 113)
4️⃣ Choose 📘 Mid, 📗 Final or 📚 All files
5️⃣ Tap a file to receive it, or tap “Send all”

🔎 Can't find a file? Report it with /report and your message, e.g. <code>/report your message</code>`;

const WELCOME = `👋 <b>Welcome to DIU Class Materials!</b>

📚 This bot keeps lecture slides, PDFs and other class materials in one place, organised by department, semester and course code.

${HOW_TO}

<b>Commands</b>
/start – open the menu
/help – how to use the bot
/about – about the bot
/report – report a missing file`;

const ABOUT = `ℹ️ <b>About DIU Class Materials</b>

A free bot made for students to find lecture slides, PDFs and other course files quickly, without searching through chats and groups.

Materials are added by admins. If a file is missing, type /report and your message.`;

const ADMIN_HELP = `🛠 <b>Admin: adding materials</b>
Send the file to this bot (or post it in the storage channel) with this caption:
<code>CSE | Summer 2026 | CSE 113 | Mid | Lecture 1</code>
Write <b>Mid</b> or <b>Final</b> as the 4th part, or <b>-</b> for material that belongs to the whole course (it shows under All files).

No caption, or a wrong one? The bot asks you with buttons. If you leave out the exam (4 parts), it asks Mid or Final.
Duplicates (same semester, course, exam and title) are skipped.

📅 <b>Current or previous semester?</b>
A file with a caption is saved to the <b>current semester</b> (the files tab). For a <b>previous semester</b>, use the buttons or /batch: the bot first asks "Current or previous semester?" and saves into the archive tab.

📦 <b>Uploading many files at once</b>
1. Send /batch, choose current or previous semester, then the department, semester, course and exam.
2. Send your files (4–5 at a time works well). For each file the bot asks for a title: reply to its message with a title, or tap the suggested file name.
3. Send /done when you finish.

/cancel – cancel an unfinished upload or batch`;

/* ================= entry point ================= */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('DIU Class Materials bot is running ✅');

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).send('unauthorized');
  }

  try {
    const u = req.body || {};
    if (u.message) await onMessage(u.message);
    else if (u.channel_post) await onChannelPost(u.channel_post);
    else if (u.callback_query) await onCallback(u.callback_query);
  } catch (e) {
    console.error(e); // always answer 200 so Telegram doesn't retry forever
  }
  res.status(200).send('ok');
}

/* ================= small UI helpers ================= */

const btn = (text, data) => ({ text, callback_data: data });
const kb = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const short = (s, n = 45) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function render(chatId, msgId, text, keyboard) {
  const extra = kb(keyboard);
  return msgId ? editMessage(chatId, msgId, text, extra) : sendMessage(chatId, text, extra);
}

/* ================= messages & commands ================= */

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const from = msg.from?.id;
  const text = (msg.text || '').trim();

  if (text.startsWith('/')) return onCommand(msg, text);

  const file = extractFile(msg);
  if (file) {
    if (!isAdmin(from)) return sendMessage(chatId, '🔒 Only admins can upload materials.');
    return handleUpload({
      file,
      caption: msg.caption || '',
      adminId: from,
      chatId,
      source: { chat_id: chatId, message_id: msg.message_id },
      grouped: Boolean(msg.media_group_id),
    });
  }

  if (text && isAdmin(from)) {
    // 1) a title typed as a reply to a batch question
    const replyId = msg.reply_to_message?.message_id;
    if (replyId) {
      const key = `bf:${from}:${replyId}`;
      const e = await getPending(key);
      if (e) return finishBatchFile(chatId, key, e, normTitle(clean(text)));
    }
    // 2) a value typed for the button upload (New department, etc.)
    const p = await getPending(from);
    if (p?.awaiting) return onPendingText(from, chatId, p, text);
    // 3) a title typed without replying
    const waiting = await listPending(`bf:${from}:`);
    if (waiting.length === 1) {
      return finishBatchFile(chatId, waiting[0].key, waiting[0].data, normTitle(clean(text)));
    }
    if (waiting.length > 1) {
      return sendMessage(
        chatId,
        `You have ${waiting.length} files waiting for a title. Please <b>reply</b> to the message of the file you mean.`
      );
    }
  }
  if (text) return sendMessage(chatId, 'Use /start to browse class materials 📚');
}

async function onCommand(msg, text) {
  const chatId = msg.chat.id;
  const from = msg.from?.id;
  const cmd = text.split(/[\s@]/)[0].toLowerCase();

  switch (cmd) {
    case '/start':
      return showHome(chatId, null, true);
    case '/help': {
      const depts = await allDepts();
      const keyboard = chunk(depts.map((d) => btn(`🏫 ${d}`, `S|${d}`)), 2);
      const helpText =
        HOW_TO +
        '\n\n💡 Use /start any time to go back to the menu.' +
        (isAdmin(from) ? `\n\n${ADMIN_HELP}` : '');
      return sendMessage(chatId, helpText, kb(keyboard));
    }
    case '/about':
      return sendMessage(chatId, ABOUT);
    case '/id':
      return sendMessage(chatId, `Your Telegram ID: <code>${from}</code>`);
    case '/report':
      return onReport(msg, text);
    case '/batch':
      if (!isAdmin(from)) return;
      return startBatchSelect(from, chatId);
    case '/done':
      if (!isAdmin(from)) return;
      await clearPending(`batch:${from}`);
      return sendMessage(chatId, '✅ Batch mode is off.');
    case '/cancel':
      if (!isAdmin(from)) return;
      await clearPending(from);
      await clearPending(`batch:${from}`);
      for (const w of await listPending(`bf:${from}:`)) await clearPending(w.key);
      return sendMessage(chatId, '✖️ Cancelled.');
    default:
      return sendMessage(chatId, 'Unknown command. Try /start');
  }
}

/* ================= /report (missing file) ================= */

const REPORT_LIMIT = 3; // reports each student may send ...
const REPORT_WINDOW_MS = 60 * 60 * 1000; // ... per hour (admins are not limited)

async function onReport(msg, text) {
  const chatId = msg.chat.id;
  const what = text.replace(/^\/report(@\w+)?\s*/i, '').trim().slice(0, 500);

  if (!what) {
    return sendMessage(
      chatId,
      '✍️ Please write your message after the command, for example:\n<code>/report your message</code>'
    );
  }

  // Rate limit (kept in the "limits" tab). If that tab has a problem, reports still go through.
  const uid = msg.from?.id;
  const limited = !isAdmin(uid);
  if (limited) {
    try {
      const usage = await getReportUsage(uid, REPORT_WINDOW_MS);
      if (usage.count >= REPORT_LIMIT) {
        const waitMin = Math.max(1, Math.ceil((usage.start + REPORT_WINDOW_MS - Date.now()) / 60000));
        return sendMessage(
          chatId,
          `⏳ You have reached the report limit. Please try again in about ${waitMin} minute(s).`
        );
      }
    } catch (e) {
      console.error('report limit check failed', e);
    }
  }

  const u = msg.from || {};
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'A student';
  const who = `<a href="tg://user?id=${u.id}">${esc(name)}</a>` + (u.username ? ` (@${esc(u.username)})` : '');

  // 1) save the report in the "reports" tab
  let saved = false;
  try {
    await logReport({ userId: u.id, name, username: u.username, message: what });
    saved = true;
  } catch (e) {
    console.error('report save failed', e);
  }

  // 2) notify the admins
  let sent = 0;
  for (const id of ADMIN_IDS) {
    const m = await sendMessage(id, `📩 <b>New report</b>\n\nFrom: ${who}\nMessage: <b>${esc(what)}</b>`);
    if (m) sent++;
  }

  const ok = saved || sent > 0;
  if (ok && limited) {
    try {
      await addReport(uid, REPORT_WINDOW_MS);
    } catch (e) {
      console.error('report limit save failed', e);
    }
  }

  return sendMessage(
    chatId,
    ok
      ? '✅ Thanks! Your report was sent to the admins.'
      : '⚠️ Sorry, I could not send your report right now. Please try again later.'
  );
}

/* ================= student menu ================= */

const courseFiles = (rows, dept, sem, course) =>
  rows.filter((r) => r.dept === dept && r.semester === sem && r.course === course);

/* Two lists of files:
   current semester  = "files" tab    -> menu buttons like  S|…  C|…  F|…  X|…  G|…  A|…
   previous semesters = "archive" tab -> the same buttons with a "~" after the letter: S~|…  C~|… (one extra byte) */
const act = (letter, arch, ...parts) => [arch ? `${letter}~` : letter, ...parts].join('|');

// Departments for the home menu: the current ones, plus any that only have old files.
async function allDepts() {
  const [rows, old] = await Promise.all([getFiles(), getArchiveDepts()]);
  return unique([...rows.map((r) => r.dept), ...old]).sort();
}

async function showHome(chatId, msgId, welcome = false) {
  const depts = await allDepts();
  const head = welcome ? `${WELCOME}\n\n` : '';
  if (!depts.length) {
    return render(chatId, msgId, `${head}📭 No materials have been added yet. Please check back soon!`, []);
  }
  const keyboard = chunk(depts.map((d) => btn(`🏫 ${d}`, `S|${d}`)), 2);
  return render(chatId, msgId, `${head}👇 <b>Select your department</b>`, keyboard);
}

async function showSemesters(chatId, msgId, dept, arch = false) {
  const rows = await getFiles(false, arch);
  const sems = unique(rows.filter((r) => r.dept === dept).map((r) => r.semester)).sort(semSort);
  const keyboard = chunk(sems.map((s) => btn(`📅 ${s}`, act('C', arch, dept, s))), 2);

  if (!arch && (await getArchiveDepts()).includes(dept)) {
    keyboard.push([btn('📁 Previous semesters', act('S', true, dept))]);
  }
  keyboard.push([btn('⬅️ Back', arch ? `S|${dept}` : 'D')]);

  const title = arch ? '📁 <b>Previous semesters</b>' : '👇 <b>Select the semester</b>';
  const note = arch && !sems.length ? '\n\nNo previous semesters have been added yet.' : '';
  return render(chatId, msgId, `🏫 <b>${esc(dept)}</b>\n\n${title}${note}`, keyboard);
}

async function showCourses(chatId, msgId, dept, sem, arch = false) {
  const rows = await getFiles(false, arch);
  const courses = unique(
    rows.filter((r) => r.dept === dept && r.semester === sem).map((r) => r.course)
  ).sort();
  const keyboard = chunk(courses.map((c) => btn(`🎓 ${c}`, act('F', arch, dept, sem, c))), 2);
  keyboard.push([btn('⬅️ Back', arch ? act('S', true, dept) : `S|${dept}`)]);
  return render(
    chatId,
    msgId,
    `🏫 <b>${esc(dept)}</b> · 📅 <b>${esc(sem)}</b>\n\n👇 <b>Select the course</b>`,
    keyboard
  );
}

const EXAM_CODE = { m: 'Mid', f: 'Final' };
const EXAM_ICON = { Mid: '📘', Final: '📗' };
// 'a' (or anything unknown) = all files
const inView = (f, code) => !EXAM_CODE[code] || f.exam === EXAM_CODE[code];

async function showExams(chatId, msgId, dept, sem, course, arch = false) {
  const all = courseFiles(await getFiles(false, arch), dept, sem, course);
  const n = (exam) => all.filter((f) => f.exam === exam).length;
  const base = `${dept}|${sem}|${course}`;
  const keyboard = [
    [btn(`📘 Mid (${n('Mid')})`, `${act('X', arch)}|${base}|m`)],
    [btn(`📗 Final (${n('Final')})`, `${act('X', arch)}|${base}|f`)],
    [btn(`📚 All files (${all.length})`, `${act('X', arch)}|${base}|a`)],
    [btn('⬅️ Back', act('C', arch, dept, sem))],
  ];
  return render(
    chatId,
    msgId,
    `🎓 <b>${esc(course)}</b> · ${esc(sem)}\n\n👇 <b>Select an option</b>`,
    keyboard
  );
}

async function showFiles(chatId, msgId, dept, sem, course, code = 'a', arch = false) {
  const rows = await getFiles(false, arch);
  const list = courseFiles(rows, dept, sem, course)
    .map((f, i) => ({ ...f, i })) // i = position in the course's sheet order (used by the buttons)
    .filter((f) => inView(f, code))
    .sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));

  const base = `${dept}|${sem}|${course}`;
  const keyboard = list.slice(0, 90).map((f) => {
    const tag = !EXAM_CODE[code] && f.exam ? ` · ${f.exam}` : ''; // in All files, show Mid/Final next to the title
    return [btn(`${CAT_ICON[f.category] || '📁'} ${short(f.title)}${tag}`, `${act('G', arch)}|${base}|${f.i}`)];
  });
  if (list.length > 1) keyboard.push([btn('📥 Send all', `${act('A', arch)}|${base}|${EXAM_CODE[code] ? code : 'a'}`)]);
  keyboard.push([btn('⬅️ Back', `${act('F', arch)}|${base}`)]);

  const heading = EXAM_CODE[code] ? `${EXAM_ICON[EXAM_CODE[code]]} ${EXAM_CODE[code]}` : '📚 All files';
  const body = list.length
    ? `${list.length} file(s)\n\n👇 Tap a file to receive it.`
    : 'No files have been added here yet.';

  return render(
    chatId,
    msgId,
    `🎓 <b>${esc(course)}</b> · ${esc(sem)} · <b>${heading}</b>\n${body}\n\nCan't find the file you're looking for? Type /report and your message.`,
    keyboard
  );
}

const fileCaption = (f) => `🎓 ${esc(f.course)}${f.exam ? ` · ${f.exam}` : ''} · ${esc(f.title)}`;

/* ================= callbacks ================= */

async function onCallback(cq) {
  const chatId = cq.message?.chat.id;
  const msgId = cq.message?.message_id;
  if (!chatId) return answerCb(cq.id);

  const [raw, ...p] = (cq.data || '').split('|');
  if (raw === 'u') return onUploadCb(cq, p);
  if (raw === 'b') return onBatchCb(cq, p);

  // "C~" = the same button, but for the archive tab (previous semesters)
  const arch = raw.endsWith('~');
  const a = arch ? raw.slice(0, -1) : raw;

  switch (a) {
    case 'D':
      await answerCb(cq.id);
      return showHome(chatId, msgId);
    case 'S':
      await answerCb(cq.id);
      return showSemesters(chatId, msgId, p[0], arch);
    case 'C':
      await answerCb(cq.id);
      return showCourses(chatId, msgId, p[0], p[1], arch);
    case 'F':
      await answerCb(cq.id);
      return showExams(chatId, msgId, p[0], p[1], p[2], arch);
    case 'X':
      await answerCb(cq.id);
      return showFiles(chatId, msgId, p[0], p[1], p[2], p[3], arch);
    case 'G': {
      const [dept, sem, course, i] = p;
      const f = courseFiles(await getFiles(false, arch), dept, sem, course)[Number(i)];
      if (!f) return answerCb(cq.id, 'File not found. Please reopen the menu.', true);
      await answerCb(cq.id);
      return sendFile(chatId, f.kind, f.file_id, fileCaption(f));
    }
    case 'A': {
      const [dept, sem, course, code = 'a'] = p;
      const list = courseFiles(await getFiles(false, arch), dept, sem, course).filter((f) => inView(f, code));
      await answerCb(cq.id, `Sending ${list.length} file(s)…`);
      for (const f of list) {
        await sendFile(chatId, f.kind, f.file_id, fileCaption(f));
        await sleep(400); // stay under Telegram's rate limit
      }
      return;
    }
    default:
      return answerCb(cq.id);
  }
}

/* ================= uploading (admin) ================= */

const DEFAULT_DEPTS = ['CSE', 'SWE', 'EEE', 'CIS']; // edit freely; shown only in the admin upload menu
const defaultSemesters = () => {
  const y = new Date().getFullYear();
  return [`Spring ${y}`, `Summer ${y}`, `Fall ${y}`];
};

const FIELD = { d: 'dept', s: 'semester', c: 'course', e: 'exam' };
const NORM = { dept: normDept, semester: normSemester, course: normCourse, exam: (v) => normExam(v) ?? '', title: normTitle };
const LABEL = { dept: 'department', semester: 'semester', course: 'course code', exam: 'exam', title: 'title' };
const NEXT = { dept: 'semester', semester: 'course', course: 'exam', exam: 'title' };
const clean = (s) => s.replace(/\|/g, '/').slice(0, 60);

// Same dept + semester + course + exam + title (case-insensitive) = duplicate.
// The semester is included because the same course repeats every semester,
// and the exam is included so "Lecture 1" can exist in both Mid and Final.
const dupKey = (r) =>
  [r.dept, r.semester, r.course, r.exam || '', r.title].map((x) => String(x).toLowerCase().trim()).join('|');

// archive = true saves into the "archive" tab (previous semesters); false = the "files" tab (current semester)
async function saveFile({ dept, semester, course, exam = '', title, file, source, archive = false }) {
  // callback_data is limited to 64 bytes, so names must stay short
  if (Buffer.byteLength(`${archive ? 'G~' : 'G'}|${dept}|${semester}|${course}|99`) > 64) {
    return {
      ok: false,
      text: '❌ Names are too long for the menu. Use short names, e.g. CSE, Summer 2026, CSE 113.',
    };
  }

  const rows = await getFiles(true, archive);
  const key = dupKey({ dept, semester, course, exam, title });
  if (rows.some((r) => dupKey(r) === key)) {
    return {
      ok: false,
      text: `⚠️ <b>Skipped</b> – “${esc(title)}” already exists in ${esc(course)} (${esc(semester)}${exam ? `, ${esc(exam)}` : ''}).`,
    };
  }

  await addFile({ dept, semester, course, exam, title, category: file.category, file_id: file.file_id, kind: file.kind }, archive);

  // Back up files that did not come from the storage channel
  if (CHANNEL_ID && source && String(source.chat_id) !== CHANNEL_ID) {
    await copyMessage(
      CHANNEL_ID,
      source.chat_id,
      source.message_id,
      `${dept} | ${semester} | ${course} | ${exam || '-'} | ${title}`
    );
  }

  return {
    ok: true,
    text: `✅ <b>Saved!</b>${archive ? ' (previous semester)' : ''}\n\n🏫 ${esc(dept)}\n📅 ${esc(semester)}\n🎓 ${esc(course)}\n📝 ${esc(exam || 'General')}\n${CAT_ICON[file.category] || '📁'} ${esc(title)}`,
  };
}

async function handleUpload({ file, caption, adminId, chatId, source, fromChannel = false, grouped = false }) {
  file.category = categoryOf(file.name, file.kind);

  const parsed = parseCaption(caption);
  if (parsed) {
    // A caption saves to the current semester ("files" tab) - unless /batch mode is on,
    // then it follows what was chosen for the batch (current or previous semester).
    const bctx = await getPending(`batch:${adminId}`);
    const archive = Boolean(bctx?.arch);
    let exam = parsed.exam;
    if (exam === null && bctx) exam = bctx.exam || ''; // 4-part caption: use the exam chosen with /batch
    if (exam !== null) {
      const r = await saveFile({ ...parsed, exam, file, source, archive });
      return sendMessage(chatId, (fromChannel ? '📥 <i>From the channel</i>\n' : '') + r.text);
    }
    // Everything is known except the exam -> ask only that
    const q = {
      file,
      source,
      arch: false,
      dept: parsed.dept,
      semester: parsed.semester,
      course: parsed.course,
      title: parsed.title,
      step: 'exam',
      awaiting: null,
    };
    return promptStep(adminId, chatId, q);
  }

  // Batch mode: no valid caption -> ask for this file's title (course was chosen with /batch)
  const ctx = await getPending(`batch:${adminId}`);
  if (ctx) return askBatchTitle({ ctx, file, caption, grouped, chatId, adminId, source });

  // Caption missing or wrong -> ask with buttons
  const p = {
    file,
    source,
    step: 'where', // first question: current or previous semester?
    awaiting: null,
    titleDefault: caption && !caption.includes('|') ? normTitle(caption) : baseName(file.name),
  };
  const ok = await promptStep(adminId, chatId, p);
  if (!ok && fromChannel && CHANNEL_ID) {
    await sendMessage(
      CHANNEL_ID,
      '⚠️ I could not read the caption of the last file. Use <code>DEPT | Semester | COURSE | Mid | Title</code>, or open the bot (/start) so it can ask you with buttons.'
    );
  }
}

function summary(p) {
  const l = [p.file ? `📎 <b>${esc(p.file.name || p.file.kind)}</b>` : '📦 <b>Batch upload</b>'];
  if (p.arch !== undefined) l.push(p.arch ? '📁 Previous semester' : '🟢 Current semester');
  if (p.dept) l.push(`🏫 ${esc(p.dept)}`);
  if (p.semester) l.push(`📅 ${esc(p.semester)}`);
  if (p.course) l.push(`🎓 ${esc(p.course)}`);
  if (p.exam !== undefined) l.push(`📝 ${esc(p.exam || 'General')}`);
  return l.join('\n');
}

// Shows the current step (current/previous -> dept -> semester -> course -> exam -> title).
// Returns false if the message could not be sent.
async function promptStep(adminId, chatId, p) {
  const rows = p.step === 'where' ? [] : await getFiles(false, Boolean(p.arch)); // suggestions come from the chosen tab
  let text;
  let code = '';
  let options = [];

  if (p.step === 'where') {
    text = 'Is this for the <b>current semester</b> or a <b>previous semester</b>?';
  } else if (p.step === 'dept') {
    code = 'd';
    text = 'Select the <b>department</b>:';
    options = unique([...DEFAULT_DEPTS, ...rows.map((r) => r.dept)]).sort();
  } else if (p.step === 'semester') {
    code = 's';
    text = 'Select the <b>semester</b>:';
    options = unique([...defaultSemesters(), ...rows.filter((r) => r.dept === p.dept).map((r) => r.semester)]).sort(semSort);
  } else if (p.step === 'course') {
    code = 'c';
    text = 'Select the <b>course</b>:';
    options = unique(rows.filter((r) => r.dept === p.dept).map((r) => r.course)).sort();
  } else if (p.step === 'exam') {
    code = 'e';
    text = 'Which <b>exam</b> is this for?';
  } else {
    text =
      'Send the <b>title</b> as a message (e.g. <i>Lecture 1</i>)' +
      (p.titleDefault ? ', or use the suggested one:' : '.');
  }

  let keyboard;
  if (p.step === 'where') {
    keyboard = [[btn('🟢 Current semester', 'u|w|c')], [btn('📁 Previous semester', 'u|w|p')]];
  } else if (p.step === 'exam') {
    keyboard = [
      [btn('📘 Mid', 'u|e|Mid'), btn('📗 Final', 'u|e|Final')],
      [btn('📚 General (whole course)', 'u|e|-')],
    ];
  } else if (p.step === 'title') {
    p.awaiting = 'title';
    keyboard = p.titleDefault ? [[btn(`Use: ${short(p.titleDefault, 40)}`, 'u|t|*')]] : [];
  } else {
    keyboard = chunk(options.map((o) => btn(o, `u|${code}|${o}`)), 2);
    keyboard.push([btn('➕ New', `u|${code}|*`)]);
  }
  keyboard.push([btn('✖️ Cancel', 'u|x')]);

  const full = `${summary(p)}\n\n${text}`;
  if (p.prompt_id) {
    await editMessage(chatId, p.prompt_id, full, kb(keyboard));
  } else {
    const m = await sendMessage(chatId, full, kb(keyboard));
    if (!m) return false;
    p.prompt_id = m.message_id;
  }
  await setPending(adminId, p);
  return true;
}

async function onUploadCb(cq, parts) {
  const [op, ...rest] = parts;
  const val = rest.join('|');
  const adminId = cq.from.id;
  const chatId = cq.message?.chat.id;
  const msgId = cq.message?.message_id;

  if (!isAdmin(adminId)) return answerCb(cq.id, 'Admins only.', true);

  const p = await getPending(adminId);
  if (!p || p.prompt_id !== msgId) {
    return answerCb(cq.id, 'This upload request has expired.', true);
  }
  await answerCb(cq.id);

  if (op === 'x') {
    await clearPending(adminId);
    return editMessage(chatId, msgId, '✖️ Upload cancelled.');
  }

  if (op === 't') {
    p.title = p.titleDefault;
    return finish(adminId, chatId, p);
  }

  if (op === 'w') {
    // current or previous semester -> then start the normal steps
    p.arch = val === 'p';
    p.step = 'dept';
    p.awaiting = null;
    return promptStep(adminId, chatId, p);
  }

  const field = FIELD[op];
  if (!field) return;

  if (val === '*') {
    // "New" -> wait for the admin to type the value
    p.awaiting = field;
    await setPending(adminId, p);
    return editMessage(
      chatId,
      msgId,
      `${summary(p)}\n\n✍️ Type the new <b>${LABEL[field]}</b> and send it:`,
      kb([[btn('✖️ Cancel', 'u|x')]])
    );
  }

  p[field] = NORM[field](val);
  p.awaiting = null;
  if (field === 'exam' && p.title) return finish(adminId, chatId, p); // the caption already had the title
  p.step = NEXT[field];
  if (p.mode === 'batch' && field === 'exam') return beginBatch(adminId, chatId, p);
  return promptStep(adminId, chatId, p);
}

async function onPendingText(adminId, chatId, p, text) {
  const field = p.awaiting;
  const value = NORM[field](clean(text));
  if (!value) return;

  p[field] = value;
  p.awaiting = null;
  if (field === 'title') return finish(adminId, chatId, p);

  p.step = NEXT[field];
  if (p.mode === 'batch' && field === 'exam') return beginBatch(adminId, chatId, p);
  return promptStep(adminId, chatId, p);
}

async function finish(adminId, chatId, p) {
  const r = await saveFile({
    dept: p.dept,
    semester: p.semester,
    course: p.course,
    exam: p.exam || '',
    title: p.title,
    file: p.file,
    source: p.source,
    archive: Boolean(p.arch),
  });
  await clearPending(adminId);
  return editMessage(chatId, p.prompt_id, r.text);
}

/* ================= batch mode (/batch ... /done) ================= */

async function startBatchSelect(adminId, chatId) {
  await clearPending(`batch:${adminId}`);
  const p = { mode: 'batch', step: 'where', awaiting: null };
  await promptStep(adminId, chatId, p);
}

async function beginBatch(adminId, chatId, p) {
  await setPending(`batch:${adminId}`, {
    dept: p.dept,
    semester: p.semester,
    course: p.course,
    exam: p.exam || '',
    arch: Boolean(p.arch),
  });
  await clearPending(adminId);
  return editMessage(
    chatId,
    p.prompt_id,
    `📦 <b>Batch mode is on</b>\n\n${p.arch ? '📁 Previous semester' : '🟢 Current semester'}\n🏫 ${esc(p.dept)}\n📅 ${esc(p.semester)}\n🎓 ${esc(p.course)}\n📝 ${esc(p.exam || 'General')}\n\nNow send your files (4–5 at a time works well). For each file I will ask for a title: reply to my message with a title, or tap the suggested file name.\n\nSend /done when you finish.`
  );
}

// One question per file. Each question has its own row in the pending tab,
// keyed by the question's message id, so files sent together never clash.
async function askBatchTitle({ ctx, file, caption, grouped, chatId, adminId, source }) {
  const suggestion =
    caption && !caption.includes('|') && !grouped ? normTitle(caption) : baseName(file.name);

  const keyboard = [];
  if (suggestion) keyboard.push([btn(`Use: ${short(suggestion, 40)}`, 'b|t')]);
  keyboard.push([btn('✖️ Skip this file', 'b|x')]);

  const text =
    `📎 <b>${esc(file.name || file.kind)}</b>\n` +
    `${ctx.arch ? '📁 Previous semester\n' : ''}🏫 ${esc(ctx.dept)} · 📅 ${esc(ctx.semester)} · 🎓 ${esc(ctx.course)} · 📝 ${esc(ctx.exam || 'General')}\n\n` +
    'Send the <b>title</b> as a <b>reply to this message</b>' +
    (suggestion ? ', or use the suggested one:' : '.');

  const m = await sendMessage(chatId, text, kb(keyboard));
  if (!m) return;
  await addPending(`bf:${adminId}:${m.message_id}`, { ctx, file, source, suggestion });
}

async function onBatchCb(cq, parts) {
  const op = parts[0];
  const adminId = cq.from.id;
  const chatId = cq.message?.chat.id;
  const msgId = cq.message?.message_id;
  if (!isAdmin(adminId)) return answerCb(cq.id, 'Admins only.', true);

  const key = `bf:${adminId}:${msgId}`;
  const e = await getPending(key);
  if (!e) return answerCb(cq.id, 'This question has expired.', true);
  await answerCb(cq.id);

  if (op === 'x') {
    await clearPending(key);
    return editMessage(chatId, msgId, '⏭ Skipped.');
  }
  return finishBatchFile(chatId, key, e, e.suggestion);
}

async function finishBatchFile(chatId, key, e, title) {
  const promptId = Number(key.split(':')[2]);
  const r = await saveFile({
    dept: e.ctx.dept,
    semester: e.ctx.semester,
    course: e.ctx.course,
    exam: e.ctx.exam || '',
    title,
    file: e.file,
    source: e.source,
    archive: Boolean(e.ctx.arch),
  });

  if (!r.ok) {
    // keep the question open so the admin can send a different title or skip
    return editMessage(
      chatId,
      promptId,
      `${r.text}\n\nReply with a different title, or skip this file.`,
      kb([[btn('✖️ Skip this file', 'b|x')]])
    );
  }
  await clearPending(key);
  return editMessage(chatId, promptId, `✅ <b>${esc(title)}</b> → ${esc(e.ctx.course)} · ${esc(e.ctx.semester)} · ${esc(e.ctx.exam || 'General')}`);
}

/* ================= channel mode ================= */

async function onChannelPost(post) {
  if (!CHANNEL_ID || String(post.chat.id) !== CHANNEL_ID) return;
  const file = extractFile(post);
  if (!file) return;

  const adminId = ADMIN_IDS[0]; // results and guided questions go to the first admin by DM
  if (!adminId) return;

  return handleUpload({
    file,
    caption: post.caption || '',
    adminId,
    chatId: adminId,
    source: { chat_id: post.chat.id, message_id: post.message_id },
    fromChannel: true,
    grouped: Boolean(post.media_group_id),
  });
}
