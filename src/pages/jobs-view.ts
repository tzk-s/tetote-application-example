/**
 * 募集一覧・職種別詳細の描画（公開用に作り直した最小構成）
 *
 * 一覧も詳細も、応募フォームと同じ募集データ（jobs.ts の loadJobs）から描画する。
 * 募集終了の職種は一覧から消さずに後ろへ回して「募集終了」と明示し、応募ボタンは出さない。
 * 詳細ページも 404 にはしない。外部に残ったリンクから来た人に、終了したことと一覧への道を示すため。
 * （元の WordPress テーマの一覧・詳細テンプレートと同じ方針）
 *
 * 値はすべて textContent で入れる（innerHTML は使わない）。
 */
import { detailUrl, entryUrl, loadJobs, type Job } from '../entry/jobs';

export const LOAD_ERROR_MESSAGE = '募集情報を読み込めませんでした。時間をおいて、ページを再読み込みしてください。';
export const NOT_FOUND_MESSAGE = '指定された募集は見つかりませんでした。';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

const link = (href: string, className: string, text: string, hiddenPrefix = '') => {
  const a = el('a', className);
  a.href = href;
  //  一覧では同じ文言のリンクが並ぶため、見えない職種名を前に足して読み上げで区別できるようにする
  if (hiddenPrefix) a.append(el('span', 'u-visually-hidden', hiddenPrefix));
  a.append(text);
  return a;
};

const statusBadge = (job: Job) => (job.open ? null : el('span', 'p-jobs__status', '募集終了'));

const renderRows = (job: Job) => {
  const dl = el('dl', 'p-job__rows');
  [{ term: '職種名', desc: [job.name] }, ...job.rows].forEach(row => {
    dl.append(el('dt', 'p-job__term', row.term));
    const dd = el('dd', 'p-job__desc');
    row.desc.forEach(line => dd.append(el('p', 'p-job__line', line)));
    dl.append(dd);
  });
  return dl;
};

const renderActions = (job: Job, context: 'list' | 'detail') => {
  const wrap = el('div', 'p-jobs__actions');
  if (!job.open) {
    const note = el('p', 'p-jobs__closed-note', 'この職種の募集は終了しました。');
    //  詳細ページでは、外部のリンクから来た人のために一覧への道を示す（一覧ページでは自分へのリンクになるので出さない）
    if (context === 'detail') {
      note.append('現在募集中の職種は');
      note.append(link('index.html', '', '募集一覧'));
      note.append('からご確認いただけます。');
    }
    wrap.append(note);
  }
  const buttons = el('div', 'p-jobs__buttons');
  if (context === 'list') buttons.append(link(detailUrl(job.id), 'c-button c-button--secondary', '詳細を見る', `${job.name}の`));
  else buttons.append(link('index.html', 'c-button c-button--secondary', '募集一覧へ戻る'));
  if (job.open) buttons.append(link(entryUrl(job.id), 'c-button', 'この職種に応募', `${job.name}：`));
  wrap.append(buttons);
  return wrap;
};

export const renderList = (root: HTMLElement, jobs: Job[]) => {
  const list = el('ul', 'p-jobs__list');
  jobs.forEach(job => {
    const item = el('li', 'p-jobs__item');
    const heading = el('h2', 'p-jobs__name', job.name);
    const badge = statusBadge(job);
    if (badge) heading.append(badge);
    item.append(heading);
    if (job.summary) item.append(el('p', 'p-jobs__summary', job.summary));
    item.append(renderActions(job, 'list'));
    list.append(item);
  });
  root.replaceChildren(list, link(entryUrl(), 'p-jobs__entry-link', '職種を決めずに応募する'));
};

export const renderDetail = (root: HTMLElement, jobs: Job[], id: string | null) => {
  const job = id ? jobs.find(item => item.id === id) : undefined;
  if (!job) {
    const message = el('p', 'p-job__message', NOT_FOUND_MESSAGE);
    root.replaceChildren(message, link('index.html', 'c-button c-button--secondary', '募集一覧へ戻る'));
    document.title = `募集が見つかりません｜応募フォーム連携サンプル`;
    return;
  }
  const heading = el('h2', 'p-job__name', job.name);
  const badge = statusBadge(job);
  if (badge) heading.append(badge);
  root.replaceChildren(heading, renderRows(job), renderActions(job, 'detail'));
  document.title = `${job.name}｜応募フォーム連携サンプル`;
};

/** data-view="list" / "detail" の要素に描画する */
export const setupJobsView = async (root: HTMLElement, { loadImpl, search }: { loadImpl?: typeof fetch; search?: string } = {}) => {
  const { jobsSrc, view } = root.dataset;
  if (!jobsSrc) return;
  let jobs: Job[];
  try {
    jobs = await loadJobs(jobsSrc, loadImpl);
  } catch {
    root.replaceChildren(el('p', 'p-job__message', LOAD_ERROR_MESSAGE));
    return;
  }
  if (view === 'detail') renderDetail(root, jobs, new URLSearchParams(search ?? window.location.search).get('id'));
  else renderList(root, jobs);
};
