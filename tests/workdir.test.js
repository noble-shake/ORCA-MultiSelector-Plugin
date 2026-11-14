import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { candidateFile, isId, resolveInside, scanRun, validateQuestion } from '../app/lib/workdir.js';
import { sampleOptions, tempDir, writeWorker } from './helpers.js';

test('isId accepts Orca-style ids and rejects traversal', () => {
  assert.ok(isId('run_c084ccdecf6e'));
  assert.ok(isId('B-2'));
  assert.ok(!isId('..'));
  assert.ok(!isId('a/b'));
  assert.ok(!isId('a..b'));
  assert.ok(!isId(''));
  assert.ok(!isId(42));
});

test('resolveInside keeps paths inside the base folder', (t) => {
  const base = tempDir(t);
  assert.equal(resolveInside(base, 'images/a.png'), path.join(base, 'images', 'a.png'));
  assert.equal(resolveInside(base, '../x.png'), null);
  assert.equal(resolveInside(base, 'images/../../x.png'), null);
  assert.equal(resolveInside(base, '/etc/passwd'), null);
  assert.equal(resolveInside(base, 'C:/Windows/x.png'), null);
  assert.equal(resolveInside(base, '\\\\server\\share\\x.png'), null);
  assert.equal(resolveInside(base, 'a\0.png'), null);
});

test('scanRun reads valid options and marks missing files', (t) => {
  const work = tempDir(t);
  writeWorker(work, 'run_t', 'B', sampleOptions(), { images: ['B-1.png'] });
  const { exists, workers } = scanRun(work, 'run_t');
  assert.ok(exists);
  assert.equal(workers.length, 1);
  const [b] = workers;
  assert.equal(b.name, 'B');
  assert.deepEqual(b.errors, []);
  assert.equal(b.options.dispatch, 'dispatch_b1');
  assert.deepEqual(
    b.options.options.map((o) => [o.id, o.files[0].exists]),
    [
      ['B-1', true],
      ['B-2', false],
    ],
  );
});

test('scanRun rejects unsafe file paths and reports them', (t) => {
  const work = tempDir(t);
  writeWorker(
    work,
    'run_t',
    'B',
    sampleOptions({ options: [{ id: 'B-1', title: 'x', files: ['../../secret.png', 'images/notes.txt', 'images/ok.png'] }] }),
    { images: ['ok.png'] },
  );
  const [b] = scanRun(work, 'run_t').workers;
  assert.deepEqual(b.options.options[0].files, [{ path: 'images/ok.png', exists: true }]);
  assert.equal(b.errors.length, 2);
});

test('scanRun reports broken JSON, wrong version, duplicates and name mismatch without throwing', (t) => {
  const work = tempDir(t);
  writeWorker(work, 'run_t', 'A', '{ not json');
  writeWorker(
    work,
    'run_t',
    'B',
    sampleOptions({ version: 2, worker: 'Z', options: [{ id: 'B-1', title: 'a' }, { id: 'B-1', title: 'dup' }, { title: 'no id' }] }),
  );
  const [a, b] = scanRun(work, 'run_t').workers;
  assert.equal(a.options, null);
  assert.match(a.errors[0], /JSON/);
  assert.equal(b.options.options.length, 1);
  assert.ok(b.errors.some((e) => e.includes('version')));
  assert.ok(b.errors.some((e) => e.includes('폴더 이름')));
  assert.ok(b.errors.some((e) => e.includes('중복')));
  assert.ok(b.errors.some((e) => e.includes('id가 없거나')));
});

test('scanRun flags options written for another run', (t) => {
  const work = tempDir(t);
  writeWorker(work, 'run_t', 'B', sampleOptions({ run: 'run_other' }));
  const [b] = scanRun(work, 'run_t').workers;
  assert.ok(b.errors.some((e) => e.includes('run_other')));
});

test('scanRun ignores folders with unsafe names and reports a missing run folder', (t) => {
  const work = tempDir(t);
  fs.mkdirSync(path.join(work, 'run_t', 'has space'), { recursive: true });
  assert.deepEqual(scanRun(work, 'run_t').workers, []);
  assert.equal(scanRun(work, 'run_none').exists, false);
});

test('validateQuestion needs a message id and keeps string choices only', () => {
  assert.equal(validateQuestion({ version: 1, question: 'q' }).value, null);
  const { value, errors } = validateQuestion({ version: 1, message: 'msg_1', question: 'q?', choices: ['a', '', 3, 'b'] });
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { message: 'msg_1', question: 'q?', choices: ['a', 'b'] });
});

test('candidateFile serves only existing images inside the worker folder', (t) => {
  const work = tempDir(t);
  const dir = writeWorker(work, 'run_t', 'B', sampleOptions(), { images: ['B-1.png'] });
  fs.writeFileSync(path.join(dir, 'images', 'note.txt'), 'x');
  assert.equal(candidateFile(work, 'run_t', 'B', 'images/B-1.png').type, 'image/png');
  assert.equal(candidateFile(work, 'run_t', 'B', 'images/B-2.png'), null);
  assert.equal(candidateFile(work, 'run_t', 'B', 'images/note.txt'), null);
  writeWorker(work, 'run_t', 'A', null, { images: ['A-1.png'] });
  assert.equal(candidateFile(work, 'run_t', 'B', '../A/images/A-1.png'), null);
  assert.equal(candidateFile(work, 'run_t', '..', 'B/images/B-1.png'), null);
  assert.equal(candidateFile(work, '..', 'run_t', 'B/images/B-1.png'), null);
});
