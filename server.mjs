// Settebello — serwer 7-boju.
// Zero zależności npm: node:http + wbudowane node:sqlite.
//
//   npm start
//
// Ekipa wchodzi z telefonów na http://<twoje-ip>:3051 po tym samym WiFi.
//
// Serwer jest jedynym autorytetem: przeglądarka wysyła akcje („gol dla Kate”,
// „strzał na 9”), silnik z engines.mjs przelicza stan, a wszyscy dostają
// gotową planszę i klasyfikację przez strumień SSE.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  PLAYERS,
  DISCIPLINES,
  DISCIPLINE_IDS,
  SCALE,
  WP_POINTS,
  GENERAL_RULES,
  disciplineById,
  computeStandings,
} from './config.mjs';
import { createState, setParticipants, drawState, applyAction, derive } from './engines.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT ?? 3051);
const PIN = process.env.SETTEBELLO_PIN ?? 'palio';
const DB_PATH = process.env.SETTEBELLO_DB ?? path.join(ROOT, 'settebello.db');
const RESET_PHRASE = 'Chcę wyczyścić';

// ── Baza ──────────────────────────────────────────────────────────────────────

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS disciplines (
    id         TEXT PRIMARY KEY,
    state      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    discipline TEXT NOT NULL,
    action     TEXT NOT NULL,
    at         INTEGER NOT NULL
  );
`);

const q = {
  all: db.prepare('SELECT id, state, updated_at FROM disciplines'),
  one: db.prepare('SELECT state FROM disciplines WHERE id = ?'),
  upsert: db.prepare(
    `INSERT INTO disciplines (id, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  ),
  remove: db.prepare('DELETE FROM disciplines WHERE id = ?'),
  clearAll: db.prepare('DELETE FROM disciplines'),
  log: db.prepare('INSERT INTO audit (discipline, action, at) VALUES (?, ?, ?)'),
  history: db.prepare('SELECT discipline, action, at FROM audit ORDER BY id DESC LIMIT 60'),
};

function loadRaw(id) {
  const row = q.one.get(id);
  return row ? JSON.parse(row.state) : null;
}

function saveRaw(id, state) {
  q.upsert.run(id, JSON.stringify(state), Date.now());
}

/** Pełny obraz turnieju: plansze wszystkich dyscyplin plus klasyfikacja generalna. */
function readState() {
  const boards = {};
  const placements = {};
  let updatedAt = 0;

  for (const row of q.all.all()) {
    const def = disciplineById(row.id);
    if (!def) continue;
    const outcome = derive(def, JSON.parse(row.state));
    boards[row.id] = outcome;
    placements[row.id] = outcome;
    updatedAt = Math.max(updatedAt, Number(row.updated_at));
  }

  const statuses = Object.values(boards);
  return {
    disciplines: boards,
    standings: computeStandings(placements),
    started: statuses.length,
    played: statuses.filter((s) => s.status === 'done').length,
    total: DISCIPLINE_IDS.length,
    updatedAt,
    // Zegar serwera: przeglądarki poznają po nim świeżość losowania,
    // nie polegając na własnych, rozjechanych zegarach.
    now: Date.now(),
  };
}

// ── Strumień na żywo (SSE) ────────────────────────────────────────────────────

const streams = new Set();

function broadcast() {
  const frame = `event: state\ndata: ${JSON.stringify(readState())}\n\n`;
  for (const res of streams) res.write(frame);
}

setInterval(() => {
  for (const res of streams) res.write(': ping\n\n');
}, 25_000).unref();

// ── Autoryzacja sędziego ──────────────────────────────────────────────────────

const tokens = new Set();

function pinMatches(candidate) {
  const a = Buffer.from(String(candidate ?? ''));
  const b = Buffer.from(PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAdmin(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token !== '' && tokens.has(token);
}

// ── Pomocniki HTTP ────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Za duże żądanie.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, relative);

  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    return sendJson(res, 403, { error: 'Nie tędy.' });
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 — nie ma takiej strony.');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// ── Trasy ─────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === 'GET /api/config') {
      return sendJson(res, 200, {
        players: PLAYERS,
        disciplines: DISCIPLINES,
        scale: SCALE,
        wpPoints: WP_POINTS,
        generalRules: GENERAL_RULES,
        resetPhrase: RESET_PHRASE,
      });
    }

    if (route === 'GET /api/state') {
      return sendJson(res, 200, readState());
    }

    if (route === 'GET /api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: state\ndata: ${JSON.stringify(readState())}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }

    if (route === 'POST /api/login') {
      const body = await readBody(req);
      if (!pinMatches(body.pin)) return sendJson(res, 401, { error: 'Zły PIN.' });
      const token = crypto.randomBytes(24).toString('hex');
      tokens.add(token);
      return sendJson(res, 200, { token });
    }

    if (route === 'GET /api/session') {
      return sendJson(res, 200, { admin: isAdmin(req) });
    }

    if (route === 'GET /api/history') {
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'Tylko sędzia.' });
      return sendJson(res, 200, { entries: q.history.all() });
    }

    // Wszystko poniżej zmienia turniej, więc wymaga sędziego.
    const match = url.pathname.match(
      /^\/api\/discipline\/([a-z]+)\/(start|participants|draw|action|clear)$/,
    );
    if (req.method === 'POST' && match) {
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'Tylko sędzia może prowadzić rozgrywkę.' });

      const [, id, verb] = match;
      const def = disciplineById(id);
      if (!def) return sendJson(res, 404, { error: 'Nie ma takiej dyscypliny.' });
      const body = await readBody(req);

      const needsCurrent = () => {
        const current = loadRaw(id);
        if (!current) throw new Error('Ta dyscyplina nie jest jeszcze otwarta.');
        return current;
      };

      if (verb === 'start') {
        saveRaw(id, createState(def, body.participants));
      } else if (verb === 'participants') {
        saveRaw(id, setParticipants(def, needsCurrent(), body.participants));
      } else if (verb === 'draw') {
        saveRaw(id, drawState(def, needsCurrent()));
      } else if (verb === 'clear') {
        q.remove.run(id);
      } else {
        saveRaw(id, applyAction(def, needsCurrent(), body.action));
      }

      q.log.run(id, verb === 'action' ? (body.action?.type ?? 'action') : verb, Date.now());
      broadcast();
      return sendJson(res, 200, readState());
    }

    if (route === 'POST /api/reset') {
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'Tylko sędzia.' });
      const body = await readBody(req);
      if (body.confirm !== RESET_PHRASE) {
        return sendJson(res, 400, { error: `Żeby wyczyścić turniej, wpisz dokładnie: ${RESET_PHRASE}` });
      }
      q.clearAll.run();
      q.log.run('*', 'reset', Date.now());
      broadcast();
      return sendJson(res, 200, readState());
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, url.pathname);
    }

    return sendJson(res, 405, { error: 'Nieobsługiwana metoda.' });
  } catch (err) {
    return sendJson(res, 400, { error: err.message ?? 'Coś się posypało.' });
  }
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((nic) => nic && nic.family === 'IPv4' && !nic.internal)
    .map((nic) => nic.address);
}

const inContainer = fs.existsSync('/.dockerenv');

server.listen(PORT, '0.0.0.0', () => {
  const lines = [
    '',
    '  ╔══════════════════════════════════════════════╗',
    '  ║   SETTEBELLO · 7-bój w Toskanii              ║',
    '  ╚══════════════════════════════════════════════╝',
    '',
    `  Ty (sędzia):      http://localhost:${PORT}`,
  ];

  if (process.env.SETTEBELLO_HOST) {
    lines.push(`  Ekipa po WiFi:    http://${process.env.SETTEBELLO_HOST}:${PORT}`);
  } else if (inContainer) {
    // Wewnątrz kontenera widać tylko adres sieci Dockera — dla ekipy bezużyteczny.
    lines.push(
      `  Ekipa po WiFi:    http://<IP-twojego-maca>:${PORT}`,
      '                    sprawdź go: ipconfig getifaddr en0',
      '                    albo podaj przez SETTEBELLO_HOST',
    );
  } else {
    for (const address of lanAddresses()) {
      lines.push(`  Ekipa po WiFi:    http://${address}:${PORT}`);
    }
  }

  lines.push('', `  PIN sędziego:     ${PIN}`, `  Baza:             ${DB_PATH}`, '');
  console.log(lines.join('\n'));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n  Zamykam. Wyniki zostają w bazie.\n');
    server.close();
    db.close();
    process.exit(0);
  });
}
