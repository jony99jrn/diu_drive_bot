/* ---------- config ---------- */
export const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const isAdmin = (id) => ADMIN_IDS.includes(String(id));
export const CHANNEL_ID = process.env.CHANNEL_ID ? String(process.env.CHANNEL_ID).trim() : null;

/* ---------- small helpers ---------- */
export const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
export const unique = (arr) => [...new Set(arr.filter(Boolean))];
export const baseName = (name = '') => name.replace(/\.[^.]+$/, '');

/* ---------- normalisers (keep the sheet tidy) ---------- */
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
export const normDept = (s) => s.trim().replace(/\s+/g, ' ').toUpperCase();
export const normSemester = (s) => s.trim().replace(/\s+/g, ' ').split(' ').map(cap).join(' ');
export const normCourse = (s) =>
  s
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/^([A-Z]+)\s*[-_]?\s*(\d+)$/, '$1 $2'); // cse113 -> CSE 113
export const normTitle = (s) => s.trim().replace(/\s+/g, ' ');

/* ---------- caption: "CSE | Summer 2026 | CSE 113 | Lecture 1" ---------- */
// Exam word -> 'Mid' | 'Final' | '' (whole course) | undefined (not an exam word)
export const normExam = (s = '') => {
  const x = String(s).trim().toLowerCase();
  if (/^(mid|midterm|mid-term|mid term)$/.test(x)) return 'Mid';
  if (/^(final|finals|final exam)$/.test(x)) return 'Final';
  if (/^(-|none|general|all)$/.test(x)) return '';
  return undefined;
};

// 5 parts: "CSE | Summer 2026 | CSE 113 | Mid | Lecture 1"  -> exam = 'Mid'
// 4 parts: "CSE | Summer 2026 | CSE 113 | Lecture 1"        -> exam = null (the bot asks)
export function parseCaption(caption = '') {
  const parts = caption.split('|').map((p) => p.trim());
  if (parts.length < 4 || parts.slice(0, 4).some((p) => !p)) return null;
  const [dept, semester, course, fourth, ...more] = parts;
  let exam = null;
  let titleParts = [fourth, ...more];
  if (more.length > 0) {
    const e = normExam(fourth);
    if (e !== undefined) {
      exam = e;
      titleParts = more;
    }
  }
  const title = normTitle(titleParts.join(' | '));
  if (!title) return null;
  return {
    dept: normDept(dept),
    semester: normSemester(semester),
    course: normCourse(course),
    exam,
    title,
  };
}

/* ---------- semester sorting (newest first) ---------- */
const TERM = { spring: 1, summer: 2, fall: 3 };
const semKey = (s) => {
  const year = Number((s.match(/(\d{4})/) || [])[1] || 0);
  const term = TERM[s.split(' ')[0].toLowerCase()] || 0;
  return year * 10 + term;
};
export const semSort = (a, b) => semKey(b) - semKey(a);

/* ---------- file info ---------- */
export function extractFile(msg) {
  if (msg.document)
    return { kind: 'document', file_id: msg.document.file_id, name: msg.document.file_name || '' };
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1]; // largest size
    return { kind: 'photo', file_id: p.file_id, name: '' };
  }
  if (msg.video)
    return { kind: 'video', file_id: msg.video.file_id, name: msg.video.file_name || '' };
  if (msg.audio)
    return {
      kind: 'audio',
      file_id: msg.audio.file_id,
      name: msg.audio.file_name || msg.audio.title || '',
    };
  return null;
}

export function categoryOf(name = '', kind = 'document') {
  if (kind === 'photo') return 'Image';
  if (kind === 'video') return 'Video';
  if (kind === 'audio') return 'Audio';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['ppt', 'pptx', 'pps', 'ppsx'].includes(ext)) return 'Slide';
  if (ext === 'pdf') return 'PDF';
  if (['doc', 'docx', 'txt', 'odt'].includes(ext)) return 'Doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'Sheet';
  if (['zip', 'rar', '7z'].includes(ext)) return 'Archive';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'Image';
  return 'File';
}

export const CAT_ICON = {
  Slide: '📊',
  PDF: '📕',
  Doc: '📝',
  Sheet: '📈',
  Image: '🖼',
  Video: '🎬',
  Audio: '🎧',
  Archive: '🗜',
  File: '📁',
};
export const CAT_ORDER = Object.keys(CAT_ICON);
