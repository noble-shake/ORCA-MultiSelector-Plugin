// Reads worker output folders (<work>/<run>/<worker>/options.json, question.json) and validates them.
// Only data that passes validation reaches the board. Paths never leave the worker folder.

import fs from 'node:fs';
import path from 'node:path';

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const MAX_JSON_BYTES = 256 * 1024;
const MAX_OPTIONS = 24;
const MAX_FILES_PER_OPTION = 8;
const MAX_CHOICES = 12;

export function isId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) && !value.includes('..');
}

/** Resolves `relative` inside `base`. Returns null for absolute paths, `..` escapes, or symlinks pointing outside. */
export function resolveInside(base, relative) {
  if (typeof relative !== 'string' || relative === '' || relative.includes('\0')) return null;
  if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.startsWith('\\') || relative.startsWith('/')) return null;
  const root = path.resolve(base);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  if (fs.existsSync(target)) {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) return null;
  }
  return target;
}

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function readJson(file, errors, label) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_JSON_BYTES) {
    errors.push(`${label}: 파일이 너무 큽니다 (${stat.size} bytes)`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    // A worker may be in the middle of writing the file; the next scan picks it up.
    errors.push(`${label}: JSON을 읽지 못했습니다 (${error.message})`);
    return null;
  }
}

export function validateOptions(raw, workerDir, folderName) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { value: null, errors: ['options.json: 객체가 아닙니다'] };
  if (raw.version !== 1) errors.push(`options.json: version ${JSON.stringify(raw.version)}은 지원하지 않습니다 (1만 지원)`);
  if (raw.worker !== undefined && raw.worker !== folderName) {
    errors.push(`options.json: worker "${text(raw.worker, 64)}"가 폴더 이름 "${folderName}"과 다릅니다 — 폴더 이름을 씁니다`);
  }
  const ids = { run: raw.run, task: raw.task, dispatch: raw.dispatch };
  for (const [key, value] of Object.entries(ids)) {
    if (value !== undefined && !isId(value)) {
      errors.push(`options.json: ${key} 값이 올바르지 않습니다`);
      ids[key] = undefined;
    }
  }
  const round = Number.isInteger(raw.round) && raw.round > 0 ? raw.round : null;
  if (round === null) errors.push('options.json: round는 1 이상의 정수여야 합니다');

  const options = [];
  const seen = new Set();
  const list = Array.isArray(raw.options) ? raw.options : [];
  if (!Array.isArray(raw.options)) errors.push('options.json: options 배열이 없습니다');
  if (list.length > MAX_OPTIONS) errors.push(`options.json: 후보가 ${MAX_OPTIONS}개를 넘어 앞의 ${MAX_OPTIONS}개만 보여 줍니다`);
  for (const item of list.slice(0, MAX_OPTIONS)) {
    if (!item || typeof item !== 'object' || !isId(item.id)) {
      errors.push('options.json: id가 없거나 올바르지 않은 후보를 건너뜁니다');
      continue;
    }
    if (seen.has(item.id)) {
      errors.push(`options.json: 후보 id "${item.id}"가 중복되어 뒤의 것을 건너뜁니다`);
      continue;
    }
    seen.add(item.id);
    const files = [];
    for (const rel of (Array.isArray(item.files) ? item.files : []).slice(0, MAX_FILES_PER_OPTION)) {
      const resolved = resolveInside(workerDir, rel);
      const type = IMAGE_TYPES[path.extname(String(rel)).toLowerCase()];
      if (!resolved || !type) {
        errors.push(`options.json: 후보 ${item.id}의 파일 경로 "${text(rel, 120)}"를 쓸 수 없습니다`);
        continue;
      }
      files.push({ path: String(rel).replace(/\\/g, '/'), exists: fs.existsSync(resolved) });
    }
    options.push({ id: item.id, title: text(item.title, 200), summary: text(item.summary, 1000), files });
  }
  return {
    value: {
      run: ids.run ?? null,
      task: ids.task ?? null,
      dispatch: ids.dispatch ?? null,
      round,
      direction: text(raw.direction, 200),
      options,
    },
    errors,
  };
}

export function validateQuestion(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { value: null, errors: ['question.json: 객체가 아닙니다'] };
  if (raw.version !== 1) errors.push(`question.json: version ${JSON.stringify(raw.version)}은 지원하지 않습니다 (1만 지원)`);
  if (!isId(raw.message)) {
    errors.push('question.json: message 값이 없거나 올바르지 않아 질문을 보여 주지 않습니다');
    return { value: null, errors };
  }
  const choices = (Array.isArray(raw.choices) ? raw.choices : [])
    .filter((choice) => typeof choice === 'string' && choice.trim() !== '')
    .slice(0, MAX_CHOICES)
    .map((choice) => choice.slice(0, 200));
  return { value: { message: raw.message, question: text(raw.question, 2000), choices }, errors };
}

/** Scans <work>/<run>/ and returns one entry per valid worker folder, sorted by name. */
export function scanRun(workDir, runId) {
  const runDir = path.join(path.resolve(workDir), runId);
  let entries = [];
  try {
    entries = fs.readdirSync(runDir, { withFileTypes: true });
  } catch {
    return { exists: false, workers: [] };
  }
  const workers = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isId(entry.name)) continue;
    const dir = path.join(runDir, entry.name);
    const errors = [];
    const rawOptions = readJson(path.join(dir, 'options.json'), errors, 'options.json');
    const rawQuestion = readJson(path.join(dir, 'question.json'), errors, 'question.json');
    let options = null;
    let question = null;
    if (rawOptions !== null) {
      const result = validateOptions(rawOptions, dir, entry.name);
      options = result.value;
      errors.push(...result.errors);
    }
    if (rawQuestion !== null) {
      const result = validateQuestion(rawQuestion);
      question = result.value;
      errors.push(...result.errors);
    }
    if (options?.run && options.run !== runId) errors.push(`options.json: run "${options.run}"이 보드의 run "${runId}"과 다릅니다`);
    workers.push({ name: entry.name, options, question, errors });
  }
  workers.sort((a, b) => a.name.localeCompare(b.name));
  return { exists: true, workers };
}

/** Returns the absolute path of a candidate file for /api/file, or null when it is not allowed. */
export function candidateFile(workDir, runId, worker, relative) {
  if (!isId(runId) || !isId(worker)) return null;
  const workerDir = path.join(path.resolve(workDir), runId, worker);
  const resolved = resolveInside(workerDir, relative);
  if (!resolved) return null;
  const type = IMAGE_TYPES[path.extname(resolved).toLowerCase()];
  if (!type) return null;
  try {
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  return { file: resolved, type };
}
