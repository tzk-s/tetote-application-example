/**
 * モックの送信先（公開用の再実装。実際の送信は行わない）
 *
 * fetch と同じ形の関数を返し、CF7 の REST API と同じ形の応答（status / invalid_fields）を返す。
 * ブラウザーのメモリ内だけで動き、受け取った内容はどこにも送らず保存もしない。
 *
 * 【実環境の受付側で行っていることのうち、ここで再現するもの】
 *  - 入力項目の検証（validate.ts をそのまま使う）
 *  - 職種 ID と送信時点の受付状態の検証（jobs.ts の checkJob）
 *  - 同じ受付番号の再送を二重に受け付けない（タイムアウト後の再試行への対策）
 * 【再現しないもの】
 *  メール送信、迷惑送信対策（Turnstile・ハニーポット・送信間隔・回数制限）、管理画面での設定。
 *  モックで成功しても、実際の送信や不正送信対策を検証したことにはならない。
 */
import { checkJob, type Job } from '../entry/jobs';
import { JOB_MESSAGES } from '../entry/submit';
import { normalizeEntry, validateEntry } from '../entry/validate';

/**
 * 応答の種類（確認用の画面で切り替える）
 *  success      … 通常どおり受け付ける（入力に不備があれば validation_failed）
 *  server-error … HTTP 500 を返す（受け付けない）
 *  timeout      … 受け付けたあと応答を返さない（ブラウザー側の待機上限で打ち切られる）
 *  close-job    … 受け付ける直前に、選択された職種を募集終了にする
 */
export type MockMode = 'success' | 'server-error' | 'timeout' | 'close-job';

export interface MockReceipt {
  submissionId: string;
  jobId: string;
}

const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

/** signal が中断されるまで待つ（timeout モード用） */
const waitForAbort = (signal?: AbortSignal | null) =>
  new Promise<never>((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(abortError());
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });

const wait = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true }
    );
  });

export const createMockServer = (initialJobs: readonly Job[], { latencyMs = 0 } = {}) => {
  //  募集状態はこのモックの中で変えられるよう、複製して持つ（元データは書き換えない）
  const jobs: Job[] = initialJobs.map(job => ({ ...job }));
  const receipts: MockReceipt[] = [];
  let mode: MockMode = 'success';

  const handle = async (body: FormData): Promise<Response> => {
    const field = (key: string) => {
      const value = body.get(key);
      return typeof value === 'string' ? value : '';
    };
    const submissionId = field('submission-id');
    if (!SUBMISSION_ID_PATTERN.test(submissionId)) {
      return json({ status: 'aborted', code: 'invalid', message: '送信内容を確認できませんでした。' });
    }
    //  同じ受付番号は既に受付済み。成功として返し、記録は増やさない
    if (receipts.some(receipt => receipt.submissionId === submissionId)) {
      return json({ status: 'mail_sent', code: 'duplicate' });
    }

    const data = normalizeEntry({ name: field('name'), email: field('email'), job: field('job'), pr: field('pr') });
    if (mode === 'close-job') {
      const target = jobs.find(job => job.id === data.job);
      if (target) target.open = false;
    }

    const errors = validateEntry(data);
    if (data.job !== '') {
      const check = checkJob(data.job, jobs);
      if (check.status === 'invalid') errors.job = JOB_MESSAGES.invalidOnSubmit;
      if (check.status === 'closed') errors.job = JOB_MESSAGES.closedOnSubmit;
    }
    const invalid = Object.entries(errors).map(([key, message]) => ({ field: key, message }));
    if (invalid.length > 0) {
      return json({ status: 'validation_failed', invalid_fields: invalid });
    }

    //  記録するのは受付番号と職種 ID だけ（確認用。氏名などの入力内容は残さない）
    receipts.push({ submissionId, jobId: data.job });
    return json({ status: 'mail_sent' });
  };

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal;
    if (mode === 'server-error') {
      await wait(latencyMs, signal);
      return new Response('Internal Server Error', { status: 500 });
    }
    if (!(init?.body instanceof FormData)) return json({ status: 'aborted', code: 'invalid' }, 400);
    await wait(latencyMs, signal);
    const response = await handle(init.body);
    if (mode === 'timeout') return waitForAbort(signal);
    return response;
  };

  return {
    fetch: mockFetch as typeof fetch,
    setMode: (next: MockMode) => {
      mode = next;
    },
    getMode: () => mode,
    /** 受け付けた件数と職種 ID（入力内容は含まない） */
    receipts: () => receipts.map(receipt => ({ ...receipt })),
    jobs: () => jobs.map(job => ({ ...job })),
  };
};

export type MockServer = ReturnType<typeof createMockServer>;
