import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_ORCA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-orca.js');
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeWorker(work, run, name, options, { question, images = [] } = {}) {
  const dir = path.join(work, run, name);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  for (const image of images) fs.writeFileSync(path.join(dir, 'images', image), PNG_1PX);
  if (options !== null) fs.writeFileSync(path.join(dir, 'options.json'), typeof options === 'string' ? options : JSON.stringify(options));
  if (question) fs.writeFileSync(path.join(dir, 'question.json'), JSON.stringify(question));
  return dir;
}

export function sampleOptions(overrides = {}) {
  return {
    version: 1,
    run: 'run_t',
    task: 'task_b',
    dispatch: 'dispatch_b1',
    worker: 'B',
    round: 1,
    direction: 'dark',
    options: [
      { id: 'B-1', title: 'one', files: ['images/B-1.png'], summary: 's1' },
      { id: 'B-2', title: 'two', files: ['images/B-2.png'], summary: 's2' },
    ],
    ...overrides,
  };
}

export function orcaRow(dispatchId, taskId, runId, extra = {}) {
  return {
    dispatchId,
    taskId,
    runId,
    workerState: 'running',
    dispatchStatus: 'dispatched',
    projection: {
      outcome: null,
      liveness: { verdict: 'live' },
      stage: { activity: 'working' },
      attention: { categories: [], requiresAction: false },
    },
    ...extra,
  };
}
