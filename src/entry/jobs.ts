/**
 * 募集情報 — 読み込み・並べ替え・URL・?job= の判定
 *
 * 【募集情報の正は 1 か所】
 *  募集一覧・職種別詳細・応募フォームの選択肢・送信先の検証は、すべて同じ募集データから作る。
 *  元の実装では WordPress のカスタム投稿「募集職種」が正で、このサンプルでは public/data/jobs.json がその代わり。
 *  画面ごとに職種の一覧を書かない（書くと、募集終了の反映漏れで画面どうしが食い違う）。
 *
 * 【職種は表示名ではなく固定 ID で受け渡す】
 *  ID は投稿のスラッグに当たる値（半角英小文字・数字・ハイフン）。
 *  表示名で照合すると、名前を少し直しただけで受付側が拒否するようになるため。
 */

export interface JobRow {
  term: string;
  desc: string[];
}

export interface Job {
  /** 職種 ID。URL（?id= / ?job=）と応募フォームの送信値に使う */
  id: string;
  /** 職種名（表示用） */
  name: string;
  /** 募集中か */
  open: boolean;
  /** 一覧に出す 1 文 */
  summary: string;
  /** 募集要項（業務内容・応募条件・勤務地など） */
  rows: JobRow[];
}

/** 職種 ID の形式（WordPress のスラッグと同じ制約）。形式外は照合する前に「不正」とする */
export const JOB_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

const isString = (value: unknown): value is string => typeof value === 'string';

const toRows = (value: unknown): JobRow[] =>
  Array.isArray(value)
    ? value
        .filter(row => row && isString(row.term) && Array.isArray(row.desc))
        .map(row => ({ term: row.term, desc: row.desc.filter(isString) }))
    : [];

/**
 * 募集データを検証して並べる（DOM に依存しない。テストで直接使う）
 *  - ID の形式に合わない職種は除外する（応募の照合に使えないため。元の実装の base_get_jobs() と同じ）
 *  - 同じ ID が 2 件あれば後の方を除外する（どちらが正か決められないものを応募に使わない）
 *  - 募集中を先頭へ。終了した職種で応募の入口が埋もれないように（元の並びは保つ）
 */
export const parseJobs = (raw: unknown): Job[] => {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { jobs?: unknown }).jobs)
    ? ((raw as { jobs: unknown[] }).jobs as Record<string, unknown>[])
    : [];
  const seen = new Set<string>();
  const jobs: Job[] = [];
  list.forEach(item => {
    if (!item || !isString(item.id) || !isString(item.name) || !JOB_ID_PATTERN.test(item.id)) return;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    jobs.push({
      id: item.id,
      name: item.name,
      open: item.open === true,
      summary: isString(item.summary) ? item.summary : '',
      rows: toRows(item.rows),
    });
  });
  return [...jobs.filter(job => job.open), ...jobs.filter(job => !job.open)];
};

/** 募集データを取得する。読めなければ例外（呼び出し側で「表示できません」と案内する） */
export const loadJobs = async (src: string, fetchImpl: typeof fetch = fetch): Promise<Job[]> => {
  const res = await fetchImpl(src);
  if (!res.ok) throw new Error(`jobs: HTTP ${res.status}`);
  return parseJobs(await res.json());
};

/** 職種別詳細の URL */
export const detailUrl = (jobId: string) => `job.html?id=${encodeURIComponent(jobId)}`;

/** 「この職種に応募」のリンク先。値は表示名ではなく職種 ID。個人情報は URL に載せない */
export const entryUrl = (jobId = '') => (jobId ? `entry.html?job=${encodeURIComponent(jobId)}` : 'entry.html');

export type JobParamResult =
  | { status: 'none' }
  | { status: 'open'; id: string }
  | { status: 'closed'; name: string }
  | { status: 'invalid' };

/**
 * ?job= の値を判定する（元の実装 entryJob.js の resolveJobParam を TypeScript にしたもの）
 * @param value    ?job= の値（無ければ null）
 * @param openIds  画面に出ている募集中の職種 ID
 * @param closedJobs 募集終了の職種（案内文に出す名前は、URL の値ではなくデータ側の名前を使う）
 */
export const resolveJobParam = (
  value: string | null,
  openIds: readonly string[],
  closedJobs: readonly { id: string; name: string }[]
): JobParamResult => {
  if (value === null || value === '') return { status: 'none' };
  if (!JOB_ID_PATTERN.test(value)) return { status: 'invalid' };
  if (openIds.includes(value)) return { status: 'open', id: value };
  const closed = closedJobs.find(job => job.id === value);
  if (closed) return { status: 'closed', name: closed.name };
  return { status: 'invalid' };
};

export type JobCheck = { status: 'ok'; job: Job } | { status: 'invalid' } | { status: 'closed'; job: Job };

/**
 * 送信先で職種 ID と「いまの」受付状態を確かめる。
 * 元の実装ではサーバー側（WordPress の PHP / 静的版の GAS）が同じ判定をしている。
 * このサンプルではモックの送信先（src/mock/server.ts）が使う。
 */
export const checkJob = (value: string, jobs: readonly Job[]): JobCheck => {
  if (!JOB_ID_PATTERN.test(value)) return { status: 'invalid' };
  const job = jobs.find(item => item.id === value);
  if (!job) return { status: 'invalid' };
  return job.open ? { status: 'ok', job } : { status: 'closed', job };
};
