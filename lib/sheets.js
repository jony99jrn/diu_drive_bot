import { JWT } from 'google-auth-library';

const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.SHEET_ID}`;
const enc = encodeURIComponent;

const auth = new JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function api(path, method = 'GET', body) {
  const { token } = await auth.getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---------- Bangladesh time (GMT+6, no daylight saving) ---------- */

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;
const bdShift = (ms = Date.now()) => new Date(ms + BD_OFFSET_MS).toISOString(); // e.g. 2026-10-08T16:20:50.312Z (shifted)
const bdDate = () => bdShift().slice(0, 10); // 2026-10-08
const bdDateTime = () => bdShift().replace('T', ' ').slice(0, 16); // 2026-10-08 16:20
const bdIso = (ms) => bdShift(ms).replace('Z', '+06:00'); // 2026-10-08T16:20:50.312+06:00 (still readable by Date.parse)

/* ---------- files tab ----------
   A dept | B semester | C course | D title | E type | F file_id | G added_on | H kind | I exam */

// 'mid', 'Midterm' ... -> 'Mid'; 'final' -> 'Final'; anything else (blank) -> '' (shown under All files only)
const readExam = (s = '') => {
  const x = String(s).trim().toLowerCase();
  if (x.startsWith('mid')) return 'Mid';
  if (x.startsWith('final')) return 'Final';
  return '';
};

/* Two tabs with the same 9 columns:
   "files"   = the current semester (read all the time)
   "archive" = previous semesters (read only when a student opens "Previous semesters") */
const caches = { files: { rows: null, at: 0 }, archive: { rows: null, at: 0 } };
let archiveDepts = { list: null, at: 0 };
const TTL = 60_000; // cache the sheet for 60 seconds
const tabOf = (archive) => (archive ? 'archive' : 'files');

export async function getFiles(force = false, archive = false) {
  const tab = tabOf(archive);
  const c = caches[tab];
  if (!force && c.rows && Date.now() - c.at < TTL) return c.rows;

  let data;
  try {
    data = await api(`/values/${enc(`${tab}!A2:I`)}`);
  } catch (e) {
    if (!archive) throw e;
    console.error('archive tab could not be read', e); // e.g. the tab does not exist yet
    return [];
  }

  const rows = (data.values || [])
    .map((r) => ({
      dept: r[0] || '',
      semester: r[1] || '',
      course: r[2] || '',
      title: r[3] || '',
      category: r[4] || 'File',
      file_id: r[5] || '',
      added_on: r[6] || '',
      kind: r[7] || 'document',
      exam: readExam(r[8]),
    }))
    .filter((r) => r.file_id);
  caches[tab] = { rows, at: Date.now() };
  return rows;
}

// Which departments have old files? Reads only column A of the archive tab (small and quick).
export async function getArchiveDepts(force = false) {
  if (!force && archiveDepts.list && Date.now() - archiveDepts.at < TTL) return archiveDepts.list;
  try {
    const d = await api(`/values/${enc('archive!A2:A')}`);
    const list = [...new Set((d.values || []).map((r) => String((r && r[0]) || '').trim()).filter(Boolean))];
    archiveDepts = { list, at: Date.now() };
    return list;
  } catch (e) {
    console.error('archive departments could not be read', e);
    return [];
  }
}

export async function addFile(f, archive = false) {
  const tab = tabOf(archive);
  const today = bdDate();
  await api(
    `/values/${enc(`${tab}!A:I`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    'POST',
    {
      values: [[f.dept, f.semester, f.course, f.title, f.category, f.file_id, today, f.kind, f.exam || '']],
    }
  );
  caches[tab].rows = null;
  if (archive) archiveDepts.list = null;
}

/* ---------- /archive: move a whole semester from "files" to "archive" ---------- */

const semKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

async function readRawFiles() {
  const d = await api(`/values/${enc('files!A2:I')}`);
  return d.values || [];
}

// How many rows would move? { total, byDept: { CSE: 12, SWE: 3 } }  (always a fresh read)
export async function countSemester(semester) {
  const vals = await readRawFiles();
  const key = semKey(semester);
  const byDept = {};
  let total = 0;
  for (const r of vals) {
    if (r && semKey(r[1]) === key) {
      total++;
      const d = String(r[0] || '?').trim() || '?';
      byDept[d] = (byDept[d] || 0) + 1;
    }
  }
  return { total, byDept };
}

// Copies the semester's rows to the archive tab FIRST, and only then removes them from files.
// If the copy fails nothing is removed. Returns how many rows were moved.
export async function moveSemesterToArchive(semester) {
  const vals = await readRawFiles();
  const key = semKey(semester);
  const idx = [];
  vals.forEach((r, i) => {
    if (r && semKey(r[1]) === key) idx.push(i);
  });
  if (!idx.length) return 0;

  const sheetId = await getSheetId('files');
  if (sheetId === undefined) throw new Error('files tab not found');

  // 1) copy (always 9 columns)
  const rows = idx.map((i) => {
    const r = vals[i].slice(0, 9);
    while (r.length < 9) r.push('');
    return r;
  });
  await api(
    `/values/${enc('archive!A:I')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    'POST',
    { values: rows }
  );
  caches.archive.rows = null;
  archiveDepts.list = null;

  // 2) remove from files (runs of neighbouring rows, from the bottom up so row numbers stay right)
  const runs = [];
  for (const i of idx) {
    const last = runs[runs.length - 1];
    if (last && last.end === i) last.end = i + 1;
    else runs.push({ start: i, end: i + 1 });
  }
  try {
    try {
      await api(':batchUpdate', 'POST', {
        requests: [...runs].reverse().map(({ start, end }) => ({
          deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: start + 1, endIndex: end + 1 } },
        })),
      });
    } catch (e) {
      // Sheets refuses to delete every non-frozen row; then just empty them (blank rows are ignored by the bot)
      console.error('row delete failed, clearing instead', e);
      await api('/values:batchClear', 'POST', {
        ranges: runs.map(({ start, end }) => `files!A${start + 2}:I${end + 1}`),
      });
    }
  } catch (e) {
    const err = new Error('copied but not removed');
    err.copied = rows.length;
    err.cause = e;
    throw err;
  } finally {
    caches.files.rows = null;
  }
  return rows.length;
}

/* ---------- pending tab (guided uploads) ----------
   A user_id | B data (JSON) */

async function readPending() {
  const d = await api(`/values/${enc('pending!A2:B')}`);
  return d.values || [];
}

export async function getPending(userId) {
  const vals = await readPending();
  const row = vals.find((r) => r && String(r[0]) === String(userId) && r[1]);
  if (!row) return null;
  try {
    return JSON.parse(row[1]);
  } catch {
    return null;
  }
}

export async function setPending(userId, obj) {
  const vals = await readPending();
  let i = vals.findIndex((r) => r && String(r[0]) === String(userId));
  if (i === -1) i = vals.findIndex((r) => !r || !r[0]); // reuse a blank row
  const rowNum = (i === -1 ? vals.length : i) + 2;
  await api(
    `/values/${enc(`pending!A${rowNum}:B${rowNum}`)}?valueInputOption=RAW`,
    'PUT',
    { values: [[String(userId), JSON.stringify(obj)]] }
  );
}

export async function clearPending(userId) {
  const vals = await readPending();
  const i = vals.findIndex((r) => r && String(r[0]) === String(userId));
  if (i === -1) return;
  const rowNum = i + 2;
  await api(`/values/${enc(`pending!A${rowNum}:B${rowNum}`)}:clear`, 'POST', {});
}

// Appending is atomic, so several files arriving at the same time never overwrite each other.
export async function addPending(key, obj) {
  await api(
    `/values/${enc('pending!A:B')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    'POST',
    { values: [[String(key), JSON.stringify(obj)]] }
  );
}

export async function listPending(prefix) {
  const vals = await readPending();
  const out = [];
  for (const r of vals) {
    if (r && r[0] && r[1] && String(r[0]).startsWith(prefix)) {
      try {
        out.push({ key: String(r[0]), data: JSON.parse(r[1]) });
      } catch {
        /* ignore broken rows */
      }
    }
  }
  return out;
}

/* ---------- limits tab (/report rate limit) ----------
   A user_id | B count | C window_start (ISO time) */

async function readLimits() {
  const d = await api(`/values/${enc('limits!A2:C')}`);
  return d.values || [];
}

// How many reports this student sent in the current window, and when the window started.
export async function getReportUsage(userId, windowMs) {
  const vals = await readLimits();
  const now = Date.now();

  // tidy up: clear rows whose window has ended (one request)
  const stale = [];
  vals.forEach((r, i) => {
    if (r && r[0] && !(now - Date.parse(r[2]) < windowMs)) stale.push(`limits!A${i + 2}:C${i + 2}`);
  });
  if (stale.length) await api('/values:batchClear', 'POST', { ranges: stale });

  let usage = { count: 0, start: 0 };
  for (const r of vals) {
    if (r && String(r[0]) === String(userId)) {
      const start = Date.parse(r[2]);
      if (now - start < windowMs) usage = { count: Number(r[1]) || 0, start };
    }
  }
  return usage;
}

export async function addReport(userId, windowMs) {
  const vals = await readLimits();
  const now = Date.now();

  let i = vals.findIndex((r) => r && String(r[0]) === String(userId) && now - Date.parse(r[2]) < windowMs);
  let row;
  if (i !== -1) {
    row = [String(userId), (Number(vals[i][1]) || 0) + 1, vals[i][2]];
  } else {
    row = [String(userId), 1, bdIso(now)];
    i = vals.findIndex((r) => !r || !r[0]); // reuse a blank row so the tab stays tidy
  }
  const rowNum = (i === -1 ? vals.length : i) + 2;
  await api(`/values/${enc(`limits!A${rowNum}:C${rowNum}`)}?valueInputOption=RAW`, 'PUT', { values: [row] });
}

/* ---------- reports tab (a log of every /report) ----------
   A date | B user_id | C name | D username | E message | F done (checkbox, added by the bot) */

const sheetIds = new Map(); // tab name -> numeric sheetId (needed to format cells)

async function getSheetId(title) {
  if (sheetIds.has(title)) return sheetIds.get(title);
  const d = await api('?fields=sheets.properties(sheetId,title)');
  for (const sh of d.sheets || []) sheetIds.set(sh.properties.title, sh.properties.sheetId);
  return sheetIds.get(title);
}

export async function logReport({ userId, name, username, message }) {
  const when = `${bdDateTime()} GMT+6`;
  const res = await api(
    `/values/${enc('reports!A:E')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    'POST',
    { values: [[when, String(userId), name || '', username ? `@${username}` : '', message]] }
  );

  // Put an unchecked checkbox in column F of the new row. If this fails, the report is still saved.
  try {
    const m = /!A(\d+)/.exec(res?.updates?.updatedRange || '');
    const sheetId = await getSheetId('reports');
    if (m && sheetId !== undefined) {
      const row = Number(m[1]);
      await api(':batchUpdate', 'POST', {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 5, endColumnIndex: 6 },
              cell: {
                userEnteredValue: { boolValue: false },
                dataValidation: { condition: { type: 'BOOLEAN' } },
              },
              fields: 'userEnteredValue,dataValidation',
            },
          },
        ],
      });
    }
  } catch (e) {
    console.error('report checkbox failed', e);
  }
}
