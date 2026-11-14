// Builds the one-line messages the user copies from the board and pastes to the lead agent.
// Shared by the browser (imported as an ES module) and the tests.

const SAFE_VALUE = /^[^\s"\\]+$/;

/** Formats one value: bare when it has no spaces or quotes, otherwise double-quoted. Newlines collapse to spaces. */
export function formatValue(value) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  if (text === '') return '';
  if (SAFE_VALUE.test(text)) return text;
  return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function line(tag, pairs) {
  return `[${tag}] ` + pairs.map(([key, value]) => `${key}=${formatValue(value)}`).join(' ');
}

/** `[선택] run=… worker=… task=… dispatch=… round=… option=… note=…` */
export function selectionLine({ run, worker, task, dispatch, round, option, note }) {
  return line('선택', [
    ['run', run],
    ['worker', worker],
    ['task', task],
    ['dispatch', dispatch],
    ['round', round],
    ['option', option],
    ['note', note],
  ]);
}

/** `[답] run=… worker=… message=… answer=… note=…` */
export function answerLine({ run, worker, message, answer, note }) {
  return line('답', [
    ['run', run],
    ['worker', worker],
    ['message', message],
    ['answer', answer],
    ['note', note],
  ]);
}
