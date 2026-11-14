#!/usr/bin/env node
// Demo without Orca: writes sample worker folders to a temp directory, starts the board,
// and simulates a third worker delivering its options a few seconds later.
// npm run demo -- [--port 4317]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBoard } from './lib/board.js';

const { values } = parseArgs({ options: { port: { type: 'string', default: '4317' } } });
const RUN = 'run_demo';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-multiselector-demo-'));

function svg(label, hue) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <rect width="240" height="240" fill="hsl(${hue} 45% 88%)"/>
  <circle cx="120" cy="110" r="64" fill="hsl(${hue} 55% 55%)"/>
  <text x="120" y="215" font-family="sans-serif" font-size="28" text-anchor="middle" fill="hsl(${hue} 40% 25%)">${label}</text>
</svg>`;
}

function writeWorker(name, { dispatch, direction, options, question, round = 1, hue }) {
  const dir = path.join(work, RUN, name);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  for (const [index, option] of options.entries()) fs.writeFileSync(path.join(dir, 'images', `${option.id}.svg`), svg(option.id, hue + index * 18));
  const body = {
    version: 1,
    run: RUN,
    task: `task_${name.toLowerCase()}`,
    dispatch,
    worker: name,
    round,
    direction,
    options: options.map((o) => ({ ...o, files: [`images/${o.id}.svg`] })),
  };
  fs.writeFileSync(path.join(dir, 'options.json'), JSON.stringify(body, null, 2));
  if (question) fs.writeFileSync(path.join(dir, 'question.json'), JSON.stringify({ version: 1, ...question }, null, 2));
}

writeWorker('A', {
  dispatch: 'dispatch_a1',
  direction: '귀여운 방향',
  hue: 140,
  options: [
    { id: 'A-1', title: '둥근 잎사귀 머리', summary: '큰 눈과 짧은 팔다리로 친근한 실루엣' },
    { id: 'A-2', title: '꽃봉오리 모자', summary: '머리 위 봉오리가 감정에 따라 열린다' },
    { id: 'A-3', title: '이끼 망토', summary: '몸을 덮는 이끼 망토, 걸을 때 흔들린다' },
  ],
});
writeWorker('B', {
  dispatch: 'dispatch_b1',
  direction: '기괴한 방향',
  hue: 280,
  options: [
    { id: 'B-1', title: '비대칭 뿌리 팔', summary: '한쪽 팔만 뿌리처럼 길게 늘어진다' },
    { id: 'B-2', title: '껍질 가면', summary: '나무껍질 가면 틈으로 빛이 샌다' },
  ],
  question: { message: 'msg_demo_b', question: '뿔을 두 개로 할까요, 하나로 할까요?', choices: ['두 개', '하나'] },
});
fs.mkdirSync(path.join(work, RUN, 'C'), { recursive: true });

const board = createBoard({ workDir: work, runId: RUN, orca: null, port: Number(values.port) });
const url = await board.listen();
console.log(`데모 보드: ${url}`);
console.log(`데모 작업 폴더: ${path.join(work, RUN)}`);
console.log('5초 뒤 워커 C가 선택지를 보냅니다. 끝내려면 Ctrl+C');

setTimeout(() => {
  writeWorker('C', {
    dispatch: 'dispatch_c1',
    direction: '신비로운 방향',
    hue: 200,
    options: [
      { id: 'C-1', title: '반딧불 몸', summary: '몸 안에서 작은 빛이 떠다닌다' },
      { id: 'C-2', title: '안개 꼬리', summary: '하반신이 안개로 흩어진다' },
    ],
  });
  console.log('워커 C 선택지 도착');
}, 5000);

const stop = async () => {
  await board.close();
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
