#!/usr/bin/env node
// Starts the board: npm start -- --work <folder> --run <run_id> [--port 4317] [--no-orca] [--orca <command>]

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBoard } from './lib/board.js';
import { createOrcaClient, resolveOrcaCommand } from './lib/orca.js';
import { isId } from './lib/workdir.js';

const USAGE = `사용법: npm start -- --work <작업 폴더> --run <run_id> [옵션]

  --work <폴더>     워커 출력이 모이는 작업 폴더 (필수)
  --run <run_id>    보여 줄 Orca Run (필수). <작업 폴더>/<run_id>/<worker>/ 를 읽는다
  --port <번호>     포트 (기본 4317, 0이면 빈 포트)
  --no-orca         Orca 상태를 읽지 않고 폴더만 보여 준다
  --orca <명령>     Orca 실행 파일 (기본: ORCA_CLI_COMMAND 환경 변수, 없으면 orca)
  --help            이 도움말`;

function fail(message) {
  console.error(`오류: ${message}\n\n${USAGE}`);
  process.exit(2);
}

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      work: { type: 'string' },
      run: { type: 'string' },
      port: { type: 'string', default: '4317' },
      'no-orca': { type: 'boolean', default: false },
      orca: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  }));
} catch (error) {
  fail(error.message);
}

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!args.work) fail('--work가 필요합니다');
if (!args.run) fail('--run이 필요합니다');
if (!isId(args.run)) fail(`run id "${args.run}"는 영문·숫자·_.- 로만 쓸 수 있습니다`);
const workDir = path.resolve(args.work);
if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) fail(`작업 폴더가 없습니다: ${workDir}`);
const port = Number(args.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`포트 값이 올바르지 않습니다: ${args.port}`);

const orca = args['no-orca'] ? null : createOrcaClient(resolveOrcaCommand(args.orca));
const board = createBoard({ workDir, runId: args.run, orca, port });

try {
  const url = await board.listen();
  console.log(`보드: ${url}`);
  console.log(`작업 폴더: ${path.join(workDir, args.run)}`);
  console.log(orca ? 'Orca 상태: 읽기 전용으로 5초마다 확인' : 'Orca 상태: 꺼짐 (--no-orca)');
  console.log('끝내려면 Ctrl+C');
} catch (error) {
  if (error.code === 'EADDRINUSE') fail(`포트 ${port}를 이미 쓰고 있습니다. --port로 다른 번호를 주거나 0을 주세요`);
  throw error;
}

const stop = async () => {
  await board.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
