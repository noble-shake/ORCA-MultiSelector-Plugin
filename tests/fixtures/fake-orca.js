#!/usr/bin/env node
// Fake Orca CLI for tests. Logs every argv to FAKE_ORCA_LOG (one JSON line per call)
// and answers worker-list / worker-read from FAKE_ORCA_STATE (JSON file).

import fs from 'node:fs';

const argv = process.argv.slice(2);
if (process.env.FAKE_ORCA_LOG) fs.appendFileSync(process.env.FAKE_ORCA_LOG, JSON.stringify(argv) + '\n');

const state = process.env.FAKE_ORCA_STATE ? JSON.parse(fs.readFileSync(process.env.FAKE_ORCA_STATE, 'utf8')) : { workers: [] };
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const out = (body) => process.stdout.write(JSON.stringify({ id: 'fake', ...body }));

if (argv[0] !== 'orchestration') {
  out({ ok: false, error: { code: 'unknown_command', message: 'unknown command' } });
  process.exit(1);
}

switch (argv[1]) {
  case 'worker-list': {
    const run = flag('--run');
    const workers = state.workers.filter((w) => !run || w.runId === run);
    out({ ok: true, result: { workers, page: { hasMore: false } } });
    break;
  }
  case 'worker-read': {
    const dispatch = flag('--dispatch');
    if (!state.workers.some((w) => w.dispatchId === dispatch)) {
      out({ ok: false, error: { code: 'not_found', message: `dispatch ${dispatch} not found` } });
      process.exit(1);
    }
    out({
      ok: true,
      result: {
        dispatchId: dispatch,
        source: 'transcript',
        fallbackReason: null,
        contentComplete: false,
        warnings: ['Oversized transcript text was clipped.'],
        transcript: {
          messages: [
            { id: '1', role: 'user', blocks: [{ type: 'text', text: 'make options' }] },
            { id: '2', role: 'assistant', blocks: [{ type: 'tool-call', name: 'Write' }, { type: 'text', text: 'done' }] },
          ],
        },
      },
    });
    break;
  }
  default:
    out({ ok: false, error: { code: 'unexpected', message: `fake orca does not implement ${argv[1]}` } });
    process.exit(1);
}
