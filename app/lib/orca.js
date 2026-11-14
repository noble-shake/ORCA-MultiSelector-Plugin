// Read-only access to Orca orchestration state.
// The board must never consume the lead's inbox, so only the commands in READ_ONLY are allowed.
// `orchestration check` in particular pops messages from the coordinator inbox and is never called.

import { execFile } from 'node:child_process';
import { isId } from './workdir.js';

export const READ_ONLY = new Set(['worker-list', 'worker-read']);

/** Resolves the Orca command: explicit value, then ORCA_CLI_COMMAND, then `orca`. Returns [executable, ...prefixArgs]. */
export function resolveOrcaCommand(explicit) {
  const value = explicit || process.env.ORCA_CLI_COMMAND || 'orca';
  return Array.isArray(value) ? value : [value];
}

export function createOrcaClient(command, { timeoutMs = 20000 } = {}) {
  const [executable, ...prefix] = command;
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);

  function run(subcommand, args) {
    if (!READ_ONLY.has(subcommand)) {
      return Promise.reject(new Error(`orchestration ${subcommand} is not a read-only command`));
    }
    const argv = [...prefix, 'orchestration', subcommand, ...args, '--json'];
    return new Promise((resolve, reject) => {
      execFile(
        executable,
        argv,
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell: viaShell },
        (error, stdout, stderr) => {
          let parsed = null;
          try {
            parsed = JSON.parse(stdout);
          } catch {
            // fall through to the error below
          }
          if (parsed && parsed.ok === false) {
            const message = parsed.error?.message || parsed.error?.code || 'orca returned ok=false';
            return reject(new Error(message));
          }
          if (parsed && parsed.ok) return resolve(parsed.result);
          const detail = (stderr || error?.message || stdout || '').toString().trim().split(/\r?\n/)[0];
          reject(new Error(detail || `orca ${subcommand} failed`));
        },
      );
    });
  }

  return {
    /** Lists the Run's workers (first page, newest first, at most 100). */
    async listWorkers(runId) {
      if (!isId(runId)) throw new Error('invalid run id');
      const result = await run('worker-list', ['--run', runId, '--limit', '100']);
      const workers = (result?.workers ?? []).map(normalizeWorker).filter(Boolean);
      return { workers, hasMore: Boolean(result?.page?.hasMore) };
    },

    /** Reads the tail of one worker's conversation. */
    async readTranscript(dispatchId, limit = 20) {
      if (!isId(dispatchId)) throw new Error('invalid dispatch id');
      const result = await run('worker-read', ['--dispatch', dispatchId, '--limit', String(limit)]);
      return normalizeRead(result);
    },
  };
}

export function normalizeWorker(row) {
  if (!row || !isId(row.dispatchId)) return null;
  const projection = row.projection ?? {};
  return {
    dispatch: row.dispatchId,
    task: isId(row.taskId) ? row.taskId : null,
    run: isId(row.runId) ? row.runId : null,
    workerState: typeof row.workerState === 'string' ? row.workerState : null,
    dispatchStatus: typeof row.dispatchStatus === 'string' ? row.dispatchStatus : null,
    outcome: typeof projection.outcome === 'string' ? projection.outcome : null,
    liveness: typeof projection.liveness?.verdict === 'string' ? projection.liveness.verdict : null,
    activity: typeof projection.stage?.activity === 'string' ? projection.stage.activity : null,
    requiresAction: Boolean(projection.attention?.requiresAction),
    attention: Array.isArray(projection.attention?.categories) ? projection.attention.categories.filter((c) => typeof c === 'string') : [],
  };
}

function blockText(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text' && typeof block.text === 'string') return block.text;
  if (block.type === 'tool-call') return `[도구 호출: ${typeof block.name === 'string' ? block.name : '?'}]`;
  if (block.type === 'tool-result') return '[도구 결과]';
  return `[${typeof block.type === 'string' ? block.type : '?'}]`;
}

const MAX_MESSAGE_CHARS = 4000;

export function normalizeRead(result) {
  const base = {
    source: typeof result?.source === 'string' ? result.source : null,
    fallbackReason: result?.fallbackReason ?? null,
    contentComplete: result?.contentComplete ?? null,
    warnings: Array.isArray(result?.warnings) ? result.warnings.filter((w) => typeof w === 'string') : [],
    messages: [],
    output: null,
  };
  const messages = result?.transcript?.messages;
  if (Array.isArray(messages)) {
    base.messages = messages.map((message) => ({
      role: typeof message?.role === 'string' ? message.role : '?',
      text: (Array.isArray(message?.blocks) ? message.blocks.map(blockText).join('\n') : '').slice(0, MAX_MESSAGE_CHARS),
    }));
    return base;
  }
  // Terminal fallback: the exact shape is not pinned down, so show a bounded text rendering of what Orca returned.
  const { projection, ...rest } = result ?? {};
  base.output = JSON.stringify(rest, null, 2).slice(0, 20000);
  return base;
}
