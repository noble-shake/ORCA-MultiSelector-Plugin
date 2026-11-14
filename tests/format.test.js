import assert from 'node:assert/strict';
import test from 'node:test';
import { answerLine, formatValue, selectionLine } from '../app/public/format.js';

test('formatValue keeps simple values bare and quotes the rest', () => {
  assert.equal(formatValue('B-2'), 'B-2');
  assert.equal(formatValue(3), '3');
  assert.equal(formatValue(''), '');
  assert.equal(formatValue(undefined), '');
  assert.equal(formatValue('날개만 줄여서'), '"날개만 줄여서"');
  assert.equal(formatValue('say "hi"'), '"say \\"hi\\""');
  assert.equal(formatValue('a\\b'), '"a\\\\b"');
});

test('formatValue collapses newlines so the message stays one line', () => {
  assert.equal(formatValue('first\nsecond\r\nthird'), '"first second third"');
});

test('selectionLine matches the README format', () => {
  assert.equal(
    selectionLine({ run: 'run_abc', worker: 'B', task: 'task_b', dispatch: 'dispatch_b1', round: 1, option: 'B-2', note: '날개만 줄여서' }),
    '[선택] run=run_abc worker=B task=task_b dispatch=dispatch_b1 round=1 option=B-2 note="날개만 줄여서"',
  );
});

test('answerLine matches the README format', () => {
  assert.equal(
    answerLine({ run: 'run_abc', worker: 'B', message: 'msg_123', answer: '하나', note: '' }),
    '[답] run=run_abc worker=B message=msg_123 answer=하나 note=',
  );
  assert.equal(answerLine({ run: 'r', worker: 'B', message: 'm', answer: '두 개' }), '[답] run=r worker=B message=m answer="두 개" note=');
});
