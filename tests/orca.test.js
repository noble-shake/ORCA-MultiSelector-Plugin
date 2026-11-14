import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createOrcaClient, normalizeRead, normalizeWorker, READ_ONLY } from '../app/lib/orca.js';
import { FAKE_ORCA, orcaRow, tempDir } from './helpers.js';

function fakeClient(t, workers) {
  const dir = tempDir(t);
  const stateFile = path.join(dir, 'state.json');
  const logFile = path.join(dir, 'log.jsonl');
  fs.writeFileSync(stateFile, JSON.stringify({ workers }));
  process.env.FAKE_ORCA_STATE = stateFile;
  process.env.FAKE_ORCA_LOG = logFile;
  t.after(() => {
    delete process.env.FAKE_ORCA_STATE;
    delete process.env.FAKE_ORCA_LOG;
  });
  const calls = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { client: createOrcaClient([process.execPath, FAKE_ORCA]), calls };
}

test('only read-only orchestration commands are allowed', () => {
  assert.deepEqual([...READ_ONLY].sort(), ['worker-list', 'worker-read']);
  assert.ok(!READ_ONLY.has('check'));
});

test('listWorkers calls worker-list for the run and normalizes rows', async (t) => {
  const { client, calls } = fakeClient(t, [orcaRow('dispatch_b1', 'task_b', 'run_t'), orcaRow('dispatch_x', 'task_x', 'run_other')]);
  const { workers } = await client.listWorkers('run_t');
  assert.deepEqual(workers, [
    {
      dispatch: 'dispatch_b1',
      task: 'task_b',
      run: 'run_t',
      workerState: 'running',
      dispatchStatus: 'dispatched',
      outcome: null,
      liveness: 'live',
      activity: 'working',
      requiresAction: false,
      attention: [],
    },
  ]);
  assert.deepEqual(calls(), [['orchestration', 'worker-list', '--run', 'run_t', '--limit', '100', '--json']]);
});

test('readTranscript turns blocks into text', async (t) => {
  const { client } = fakeClient(t, [orcaRow('dispatch_b1', 'task_b', 'run_t')]);
  const read = await client.readTranscript('dispatch_b1');
  assert.equal(read.source, 'transcript');
  assert.equal(read.contentComplete, false);
  assert.deepEqual(read.messages, [
    { role: 'user', text: 'make options' },
    { role: 'assistant', text: '[도구 호출: Write]\ndone' },
  ]);
});

test('Orca errors surface as rejected promises', async (t) => {
  const { client } = fakeClient(t, []);
  await assert.rejects(client.readTranscript('dispatch_missing'), /not found/);
});

test('ids are validated before anything is executed', async (t) => {
  const { client, calls } = fakeClient(t, []);
  await assert.rejects(client.listWorkers('run; rm -rf /'), /invalid run id/);
  await assert.rejects(client.readTranscript('../x'), /invalid dispatch id/);
  assert.deepEqual(calls(), []);
});

test('normalizeWorker drops rows without a valid dispatch id', () => {
  assert.equal(normalizeWorker({ dispatchId: '../x' }), null);
  assert.equal(normalizeWorker(null), null);
});

test('normalizeRead falls back to bounded output for non-transcript sources', () => {
  const read = normalizeRead({ source: 'terminal', fallbackReason: 'no_transcript', lines: ['a', 'b'], projection: { big: true } });
  assert.equal(read.messages.length, 0);
  assert.match(read.output, /"lines"/);
  assert.doesNotMatch(read.output, /projection/);
});
