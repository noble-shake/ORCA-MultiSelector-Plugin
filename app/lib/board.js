// HTTP board: serves the page, the merged state (worker folders + Orca status), candidate images,
// worker transcripts, and an SSE stream that pushes the state whenever it changes.
// The board is read-only: every non-GET request is refused and nothing is written to disk.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateFile, isId, scanRun } from './workdir.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/static/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/static/format.js': ['format.js', 'text/javascript; charset=utf-8'],
  '/static/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

export function createBoard({ workDir, runId, orca = null, scanMs = 1000, orcaPollMs = 5000, host = '127.0.0.1', port = 4317 }) {
  if (!isId(runId)) throw new Error(`run id "${runId}" is not valid`);
  const root = path.resolve(workDir);
  const clients = new Set();
  const timers = [];
  let orcaState = { enabled: Boolean(orca), ok: null, error: null, hasMore: false, workers: [] };
  let state = null;
  let stateKey = '';
  let boundPort = port;

  function buildState() {
    const scan = scanRun(root, runId);
    const orcaWorkers = orcaState.workers;
    const used = new Set();
    const workers = scan.workers.map((worker) => {
      const dispatch = worker.options?.dispatch ?? null;
      const task = worker.options?.task ?? null;
      const match = orcaWorkers.find((w) => (dispatch && w.dispatch === dispatch) || (!dispatch && task && w.task === task)) ?? null;
      if (match) used.add(match.dispatch);
      return { ...worker, orca: match };
    });
    // Orca workers that have not written a folder yet still get a column so the user sees them working.
    for (const w of orcaWorkers) {
      if (!used.has(w.dispatch)) workers.push({ name: null, options: null, question: null, errors: [], orca: w });
    }
    return {
      run: runId,
      workDir: root,
      runFolderExists: scan.exists,
      orca: { enabled: orcaState.enabled, ok: orcaState.ok, error: orcaState.error, hasMore: orcaState.hasMore },
      workers,
    };
  }

  function refresh() {
    const next = buildState();
    const key = JSON.stringify(next);
    if (key === stateKey) return;
    state = next;
    stateKey = key;
    for (const res of clients) res.write(`event: state\ndata: ${key}\n\n`);
  }

  let polling = false;
  async function pollOrca() {
    if (!orca || polling) return;
    polling = true;
    try {
      const { workers, hasMore } = await orca.listWorkers(runId);
      orcaState = { enabled: true, ok: true, error: null, hasMore, workers };
    } catch (error) {
      // Keep the last known workers; a failed poll is not evidence that workers stopped.
      orcaState = { ...orcaState, ok: false, error: String(error.message || error) };
    } finally {
      polling = false;
    }
    refresh();
  }

  function knownDispatch(dispatch) {
    return state?.workers.some((w) => w.orca?.dispatch === dispatch || w.options?.dispatch === dispatch) ?? false;
  }

  function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }

  function allowedHost(header) {
    return header === `127.0.0.1:${boundPort}` || header === `localhost:${boundPort}` || header === `[::1]:${boundPort}`;
  }

  async function handle(req, res) {
    if (!allowedHost(req.headers.host)) return send(res, 403, { error: 'host not allowed' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'the board is read-only' }, undefined, { Allow: 'GET, HEAD' });
    const url = new URL(req.url, `http://${req.headers.host}`);

    const asset = STATIC[url.pathname];
    if (asset) return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, asset[0])), asset[1]);

    if (url.pathname === '/api/state') return send(res, 200, state ?? buildState());

    if (url.pathname === '/api/events') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      res.write(`retry: 2000\nevent: state\ndata: ${stateKey || JSON.stringify(buildState())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/api/file') {
      const found = candidateFile(root, runId, url.searchParams.get('worker'), url.searchParams.get('path'));
      if (!found) return send(res, 404, { error: 'not found' });
      return send(res, 200, fs.readFileSync(found.file), found.type);
    }

    if (url.pathname === '/api/transcript') {
      const dispatch = url.searchParams.get('dispatch');
      if (!orca) return send(res, 409, { error: 'Orca 연동이 꺼져 있습니다 (--no-orca)' });
      if (!isId(dispatch) || !knownDispatch(dispatch)) return send(res, 404, { error: 'unknown dispatch' });
      try {
        return send(res, 200, await orca.readTranscript(dispatch));
      } catch (error) {
        return send(res, 502, { error: String(error.message || error) });
      }
    }

    return send(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) send(res, 500, { error: String(error.message || error) });
      else res.end();
    });
  });

  return {
    server,
    /** Starts listening and the scan/poll loops. Resolves with the board URL. */
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          boundPort = server.address().port;
          refresh();
          timers.push(setInterval(refresh, scanMs));
          timers.push(setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000));
          if (orca) {
            pollOrca();
            timers.push(setInterval(pollOrca, orcaPollMs));
          }
          resolve(`http://${host}:${boundPort}`);
        });
      });
    },
    refresh,
    close() {
      for (const t of timers) clearInterval(t);
      for (const res of clients) res.end();
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
