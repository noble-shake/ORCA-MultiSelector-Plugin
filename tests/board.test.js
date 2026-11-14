import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createBoard } from '../app/lib/board.js';
import { createOrcaClient } from '../app/lib/orca.js';
import { FAKE_ORCA, orcaRow, sampleOptions, tempDir, writeWorker } from './helpers.js';

async function startBoard(t, { workers = [], withOrca = true } = {}) {
  const work = tempDir(t);
  const stateFile = path.join(work, 'orca-state.json');
  const logFile = path.join(work, 'orca-log.jsonl');
  fs.writeFileSync(stateFile, JSON.stringify({ workers }));
  process.env.FAKE_ORCA_STATE = stateFile;
  process.env.FAKE_ORCA_LOG = logFile;
  const orca = withOrca ? createOrcaClient([process.execPath, FAKE_ORCA]) : null;
  const board = createBoard({ workDir: work, runId: 'run_t', orca, port: 0, scanMs: 100, orcaPollMs: 200 });
  const url = await board.listen();
  t.after(async () => {
    await board.close();
    delete process.env.FAKE_ORCA_STATE;
    delete process.env.FAKE_ORCA_LOG;
  });
  const calls = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { work, url, board, stateFile, calls };
}

async function waitFor(check, { timeoutMs = 5000, stepMs = 50 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

const getJson = async (url) => {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
};

function rawRequest(url, { method = 'GET', host } = {}) {
  const { hostname, port, pathname } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: pathname, method, headers: host ? { Host: host } : {} }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the page with a strict content security policy', async (t) => {
  const { url } = await startBoard(t, { withOrca: false });
  const res = await fetch(url + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /MultiSelector/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(url + '/static/format.js')).status, 200);
  assert.equal((await fetch(url + '/static/../lib/board.js')).status, 404);
});

test('merges worker folders with Orca status and adds columns for workers without folders', async (t) => {
  const { work, url } = await startBoard(t, {
    workers: [orcaRow('dispatch_b1', 'task_b', 'run_t'), orcaRow('dispatch_c1', 'task_c', 'run_t')],
  });
  writeWorker(work, 'run_t', 'B', sampleOptions(), { images: ['B-1.png'] });
  const state = await waitFor(async () => {
    const { body } = await getJson(url + '/api/state');
    return body.orca.ok && body.workers.some((w) => w.name === 'B') ? body : null;
  });
  const b = state.workers.find((w) => w.name === 'B');
  assert.equal(b.orca.dispatch, 'dispatch_b1');
  const pending = state.workers.find((w) => w.name === null);
  assert.equal(pending.orca.dispatch, 'dispatch_c1');
});

test('pushes a new state over SSE when a worker writes options', async (t) => {
  const { work, url } = await startBoard(t, { withOrca: false });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const res = await fetch(url + '/api/events', { signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const states = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = chunk.split('\n').find((line) => line.startsWith('data: '));
          if (chunk.includes('event: state') && data) states.push(JSON.parse(data.slice(6)));
        }
      }
    } catch {
      // aborted
    }
  })();
  await waitFor(() => states.length >= 1);
  assert.equal(states[0].workers.length, 0);
  writeWorker(work, 'run_t', 'B', sampleOptions());
  const updated = await waitFor(() => states.find((s) => s.workers.some((w) => w.name === 'B')));
  assert.equal(updated.workers[0].options.options.length, 2);
  controller.abort();
  await pump;
});

test('serves candidate images and refuses anything outside the worker folder', async (t) => {
  const { work, url } = await startBoard(t, { withOrca: false });
  writeWorker(work, 'run_t', 'B', sampleOptions(), { images: ['B-1.png'] });
  fs.writeFileSync(path.join(work, 'secret.png'), 'x');
  const ok = await fetch(`${url}/api/file?worker=B&path=images/B-1.png`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  for (const bad of ['worker=B&path=../../secret.png', 'worker=..&path=secret.png', 'worker=B&path=options.json', 'worker=B']) {
    assert.equal((await fetch(`${url}/api/file?${bad}`)).status, 404, bad);
  }
});

test('is read-only and checks the Host header', async (t) => {
  const { url } = await startBoard(t, { withOrca: false });
  assert.equal(await rawRequest(url + '/api/state', { method: 'POST' }), 405);
  assert.equal(await rawRequest(url + '/api/state', { method: 'DELETE' }), 405);
  assert.equal(await rawRequest(url + '/api/state', { host: 'evil.example:80' }), 403);
  assert.equal(await rawRequest(url + '/api/state'), 200);
});

test('reads transcripts only for dispatches the board knows', async (t) => {
  const { url } = await startBoard(t, { workers: [orcaRow('dispatch_b1', 'task_b', 'run_t')] });
  await waitFor(async () => (await getJson(url + '/api/state')).body.orca.ok);
  const known = await getJson(url + '/api/transcript?dispatch=dispatch_b1');
  assert.equal(known.status, 200);
  assert.equal(known.body.messages.length, 2);
  assert.equal((await getJson(url + '/api/transcript?dispatch=dispatch_other')).status, 404);
  assert.equal((await getJson(url + '/api/transcript?dispatch=..')).status, 404);
});

test('never calls anything but read-only Orca commands', async (t) => {
  const { url, calls } = await startBoard(t, { workers: [orcaRow('dispatch_b1', 'task_b', 'run_t')] });
  await waitFor(async () => (await getJson(url + '/api/state')).body.orca.ok);
  await getJson(url + '/api/transcript?dispatch=dispatch_b1');
  await waitFor(() => calls().length >= 2);
  const subcommands = new Set(calls().map((argv) => argv[1]));
  assert.ok([...subcommands].every((s) => s === 'worker-list' || s === 'worker-read'), [...subcommands].join(','));
});

test('keeps the last known workers when an Orca poll fails', async (t) => {
  const { url, stateFile } = await startBoard(t, { workers: [orcaRow('dispatch_b1', 'task_b', 'run_t')] });
  await waitFor(async () => (await getJson(url + '/api/state')).body.orca.ok);
  fs.writeFileSync(stateFile, '{ broken');
  const state = await waitFor(async () => {
    const { body } = await getJson(url + '/api/state');
    return body.orca.ok === false ? body : null;
  });
  assert.ok(state.orca.error);
  assert.equal(state.workers[0].orca.dispatch, 'dispatch_b1');
});

test('transcript endpoint explains when Orca is off', async (t) => {
  const { url } = await startBoard(t, { withOrca: false });
  assert.equal((await getJson(url + '/api/transcript?dispatch=dispatch_b1')).status, 409);
});
