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

/* ---------- files tab ----------
   A dept | B semester | C course | D title | E type | F file_id | G added_on | H kind */

let cache = { rows: null, at: 0 };
const TTL = 60_000; // cache the sheet for 60 seconds

export async function getFiles(force = false) {
  if (!force && cache.rows && Date.now() - cache.at < TTL) return cache.rows;
  const data = await api(`/values/${enc('files!A2:H')}`);
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
    }))
    .filter((r) => r.file_id);
  cache = { rows, at: Date.now() };
  return rows;
}

export async function addFile(f) {
  const today = new Date().toISOString().slice(0, 10);
  await api(
    `/values/${enc('files!A:H')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    'POST',
    {
      values: [[f.dept, f.semester, f.course, f.title, f.category, f.file_id, today, f.kind]],
    }
  );
  cache.rows = null;
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
