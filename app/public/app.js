import { answerLine, selectionLine } from './format.js';

const $ = (id) => document.getElementById(id);
const columnsEl = $('columns');
const notes = new Map(); // keeps typed notes across re-renders
const rendered = new Map(); // column key -> { el, key }
let current = null;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function columnKey(worker) {
  return worker.name ? `w:${worker.name}` : `d:${worker.orca?.dispatch}`;
}

function statusOf(worker) {
  const orca = worker.orca;
  if (worker.question) return ['질문 대기', 'ask'];
  if (orca && (orca.workerState === 'failed' || orca.outcome === 'failed')) return ['실패', 'bad'];
  if (orca && (orca.workerState === 'succeeded' || orca.outcome === 'succeeded')) return ['완료', 'done'];
  if (worker.options?.options.length) return ['선택지 도착', 'ready'];
  if (orca) return ['작업 중', 'busy'];
  return ['대기', 'idle'];
}

async function copy(text) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const area = el('textarea', { class: 'offscreen', readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
  }
  $('copied').hidden = false;
  $('copied-text').textContent = text;
  $('copied').classList.toggle('failed', !ok);
  $('copied').querySelector('.copied-label').textContent = ok ? '복사됨 — 리드에게 붙여 넣으세요' : '자동 복사 실패 — 아래 문장을 직접 복사하세요';
  $('copied').classList.remove('flash');
  void $('copied').offsetWidth;
  $('copied').classList.add('flash');
}

function noteInput(noteKey, placeholder) {
  const input = el('input', { type: 'text', class: 'note', placeholder, 'aria-label': placeholder, 'data-note': noteKey });
  input.value = notes.get(noteKey) ?? '';
  input.addEventListener('input', () => notes.set(noteKey, input.value));
  return input;
}

function fileUrl(worker, file) {
  return `/api/file?worker=${encodeURIComponent(worker)}&path=${encodeURIComponent(file)}`;
}

function openViewer(src, caption) {
  $('viewer-img').src = src;
  $('viewer-caption').textContent = caption;
  $('viewer').showModal();
}

function renderOptions(worker) {
  const data = worker.options;
  if (!data) return null;
  const list = el('div', { class: 'options' });
  for (const option of data.options) {
    const noteKey = `${worker.name}:${data.round}:${option.id}`;
    const note = noteInput(noteKey, '메모 (선택)');
    const images = el(
      'div',
      { class: 'images' },
      option.files.map((file) =>
        file.exists
          ? el('img', {
              src: fileUrl(worker.name, file.path),
              alt: `${option.id} ${option.title}`,
              loading: 'lazy',
              onclick: () => openViewer(fileUrl(worker.name, file.path), `${option.id} · ${option.title}`),
            })
          : el('div', { class: 'missing' }, `파일 없음: ${file.path}`),
      ),
    );
    const button = el(
      'button',
      {
        type: 'button',
        class: 'primary',
        title: '이 후보를 고른다는 한 줄을 클립보드에 복사합니다',
        onclick: () =>
          copy(
            selectionLine({
              run: current.run,
              worker: worker.name,
              task: data.task ?? worker.orca?.task ?? '',
              dispatch: data.dispatch ?? worker.orca?.dispatch ?? '',
              round: data.round ?? '',
              option: option.id,
              note: notes.get(noteKey) ?? '',
            }),
          ),
      },
      '선택 복사',
    );
    list.append(
      el(
        'article',
        { class: 'option' },
        images,
        el('h3', {}, el('span', { class: 'id' }, option.id), ' ', option.title),
        option.summary ? el('p', { class: 'summary' }, option.summary) : null,
        el('div', { class: 'actions' }, note, button),
      ),
    );
  }
  return list;
}

function renderQuestion(worker) {
  const q = worker.question;
  if (!q) return null;
  const noteKey = `${worker.name}:q:${q.message}`;
  const note = noteInput(noteKey, q.choices.length ? '메모 (선택)' : '답을 적으세요');
  const answer = (value) =>
    copy(answerLine({ run: current.run, worker: worker.name, message: q.message, answer: value, note: q.choices.length ? notes.get(noteKey) ?? '' : '' }));
  const buttons = q.choices.length
    ? q.choices.map((choice) => el('button', { type: 'button', class: 'choice', onclick: () => answer(choice) }, choice))
    : [el('button', { type: 'button', class: 'primary', onclick: () => answer(notes.get(noteKey) ?? '') }, '답 복사')];
  return el('section', { class: 'question' }, el('p', { class: 'q' }, q.question || '(질문 내용 없음)'), el('div', { class: 'choices' }, buttons), note);
}

function renderTranscript(worker) {
  const dispatch = worker.orca?.dispatch ?? worker.options?.dispatch;
  if (!current.orca.enabled || !dispatch) return null;
  const body = el('div', { class: 'transcript-body' }, '열면 최근 대화를 읽어 옵니다.');
  const details = el('details', { class: 'transcript' }, el('summary', {}, '최근 대화 보기'), body);
  details.addEventListener('toggle', async () => {
    if (!details.open) return;
    body.replaceChildren('읽는 중…');
    try {
      const res = await fetch(`/api/transcript?dispatch=${encodeURIComponent(dispatch)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const parts = [];
      if (data.warnings.length || data.contentComplete === false) {
        parts.push(el('p', { class: 'muted' }, ['일부만 표시', ...data.warnings].join(' · ')));
      }
      for (const message of data.messages) parts.push(el('div', { class: `msg ${message.role}` }, el('b', {}, message.role), el('pre', {}, message.text)));
      if (data.output) parts.push(el('pre', {}, data.output));
      if (!parts.length) parts.push('대화가 없습니다.');
      body.replaceChildren(...parts);
    } catch (error) {
      body.replaceChildren(el('p', { class: 'error' }, `읽지 못했습니다: ${error.message}`));
    }
  });
  return details;
}

function renderColumn(worker) {
  const [label, tone] = statusOf(worker);
  const orca = worker.orca;
  const badges = [];
  if (orca?.liveness === 'unverifiable') badges.push(el('span', { class: 'badge warn', title: 'Orca가 이 워커의 상태를 확인하지 못했습니다. 종료됐다는 뜻은 아닙니다' }, '상태 확인 불가'));
  if (orca?.requiresAction) badges.push(el('span', { class: 'badge warn', title: '리드 에이전트가 처리할 일이 있습니다' }, '리드 확인 필요'));
  const data = worker.options;
  return el(
    'section',
    { class: `column tone-${tone}` },
    el(
      'header',
      {},
      el('div', { class: 'name' }, worker.name ?? '(출력 폴더 없음)', el('span', { class: `pill ${tone}` }, label), badges),
      data?.direction ? el('p', { class: 'direction' }, data.direction) : null,
      el(
        'p',
        { class: 'meta' },
        [data?.round ? `회차 ${data.round}` : null, orca?.dispatch ?? data?.dispatch ?? null, orca?.activity && orca.activity !== 'unknown' ? orca.activity : null]
          .filter(Boolean)
          .join(' · ') || ' ',
      ),
    ),
    worker.errors.length ? el('ul', { class: 'errors' }, worker.errors.map((e) => el('li', {}, e))) : null,
    renderQuestion(worker),
    renderOptions(worker),
    !data && !worker.question ? el('p', { class: 'muted' }, worker.name ? '아직 선택지가 없습니다.' : '워커가 아직 출력 폴더를 만들지 않았습니다.') : null,
    renderTranscript(worker),
  );
}

function render(state) {
  current = state;
  $('run').textContent = `run ${state.run}`;
  const status = [];
  if (!state.runFolderExists) status.push('작업 폴더 없음 — 워커가 만들면 나타납니다');
  if (!state.orca.enabled) status.push('Orca 연동 꺼짐');
  else if (state.orca.ok === false) status.push(`Orca 읽기 실패: ${state.orca.error}`);
  else if (state.orca.ok) status.push('Orca 연결됨');
  if (state.orca.hasMore) status.push('워커가 100개를 넘어 일부만 표시');
  $('status').textContent = status.join(' · ') || '연결됨';
  $('status').classList.toggle('bad', state.orca.ok === false);

  const seen = new Set();
  state.workers.forEach((worker, index) => {
    const key = columnKey(worker);
    seen.add(key);
    const contentKey = JSON.stringify([worker, state.orca.enabled]);
    let entry = rendered.get(key);
    if (!entry || entry.key !== contentKey) {
      const node = renderColumn(worker);
      const active = document.activeElement;
      const focused = entry && active?.dataset?.note && entry.el.contains(active) ? { note: active.dataset.note, at: active.selectionStart } : null;
      if (entry) entry.el.replaceWith(node);
      if (focused) {
        const again = [...node.querySelectorAll('input.note')].find((input) => input.dataset.note === focused.note);
        if (again) {
          again.focus();
          again.setSelectionRange(focused.at, focused.at);
        }
      }
      entry = { el: node, key: contentKey };
      rendered.set(key, entry);
    }
    if (columnsEl.children[index] !== entry.el) columnsEl.insertBefore(entry.el, columnsEl.children[index] ?? null);
  });
  for (const [key, entry] of rendered) {
    if (!seen.has(key)) {
      entry.el.remove();
      rendered.delete(key);
    }
  }
  $('empty').hidden = state.workers.length > 0;
}

$('viewer-close').addEventListener('click', () => $('viewer').close());
$('viewer').addEventListener('click', (event) => {
  if (event.target === $('viewer')) $('viewer').close();
});
$('copy-again').addEventListener('click', () => copy($('copied-text').textContent));

const events = new EventSource('/api/events');
events.addEventListener('state', (event) => render(JSON.parse(event.data)));
events.addEventListener('error', () => {
  $('status').textContent = '보드 서버와 연결이 끊겼습니다 — 다시 연결하는 중…';
  $('status').classList.add('bad');
});
