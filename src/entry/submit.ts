/**
 * 応募の送信（DOM に依存しない。テストで直接使う）
 *
 * 【送信先の形式】
 *  元の WordPress 版は Contact Form 7（以下 CF7）の REST API へ、テーマの JS から直接送る。
 *  受け付け・メール送信は CF7、フォームの HTML とサーバー側の検証はテーマ、画面の振る舞いはこの JS という分担。
 *  このサンプルは CF7 の応答の形（status / invalid_fields）を返すモックへ送る。CF7 そのものは含まない。
 *
 * 【成功応答を確認してから完了へ進む】
 *  HTTP 200 だけでは成功とみなさない。応答の status が mail_sent のときだけ success にする。
 *
 * 【待ち時間の上限】
 *  上限が無いと、通信が詰まったときに「送信中…」のまま利用者が待ち続けることになる。
 *  上限を超えたら打ち切り、入力内容を残したまま再送信を案内する。
 *  ただし打ち切ったのはブラウザー側の待機だけで、送信先では受付が済んでいるかもしれない。
 *  そのため再送信は同じ受付番号（submission-id）で送り、送信先が二重受付を防ぐ。
 */

export const SUBMIT_TIMEOUT_MS = 20000;

export type SubmitResult =
  | { kind: 'success' }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'invalid'; fields: { field: string; message: string }[] }
  | { kind: 'rejected'; code: string; message: string };

/** 画面に出す案内（元の実装の文言に合わせている） */
export const SUBMIT_MESSAGES = {
  timeout:
    '通信がタイムアウトしました。送信が完了したか確認できなかったため、入力内容はそのまま残しています。もう一度「送信する」を押してください（同じ内容が二重に受け付けられることはありません）。',
  network:
    '送信できませんでした。通信環境をご確認のうえ、もう一度「送信する」を押してください。入力内容はそのまま残しています。',
  fallback: '送信できませんでした。時間をおいて、もう一度「送信する」を押してください。入力内容はそのまま残しています。',
  invalid: '入力内容に誤りがあります。各項目の表示をご確認ください。',
  submitting: '送信しています。画面を閉じずにお待ちください。',
} as const;

/** 職種に関する案内（元の実装 entryJob.js と同じ文言） */
export const JOB_MESSAGES = {
  invalid: '指定された職種が見つかりませんでした。お手数ですが、下記の「希望職種」から選択してください。',
  closed: (name: string) => `「${name}」の募集は終了しました。現在募集中の職種から選択してください。`,
  closedOnSubmit: '選択された職種は募集を終了しました。別の職種を選択してください。',
  invalidOnSubmit: '選択された職種が見つかりません。希望職種を選び直してください。',
} as const;

/**
 * CF7 の応答を結果の種類にそろえる（元の実装 formSubmit.js の normalizeCf7Response を TypeScript にしたもの）
 * CF7 の status: mail_sent / validation_failed / acceptance_missing / spam / mail_failed / aborted
 */
export const normalizeCf7Response = (json: unknown): SubmitResult => {
  const data = json as Record<string, unknown> | null;
  if (!data || typeof data.status !== 'string') return { kind: 'network' };
  if (data.status === 'mail_sent') return { kind: 'success' };
  if (data.status === 'validation_failed' || data.status === 'acceptance_missing') {
    const fields = Array.isArray(data.invalid_fields)
      ? data.invalid_fields
          .filter(item => item && typeof item.field === 'string')
          .map(item => ({ field: item.field as string, message: typeof item.message === 'string' ? item.message : '' }))
      : [];
    return { kind: 'invalid', fields };
  }
  return {
    kind: 'rejected',
    code: typeof data.code === 'string' ? data.code : data.status,
    message: typeof data.message === 'string' ? data.message : '',
  };
};

/** 送る（元の実装 formSubmit.js の postEntry から CF7 形式の部分を抜き出したもの） */
export const postEntry = async ({
  url,
  body,
  fetchImpl = fetch,
  timeoutMs = SUBMIT_TIMEOUT_MS,
}: {
  url: string;
  body: FormData;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SubmitResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'POST', body, signal: controller.signal });
    if (!res.ok) return { kind: 'network' };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { kind: 'network' };
    }
    return normalizeCf7Response(json);
  } catch (err) {
    return { kind: (err as Error | null)?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
};

/** 受付番号。同じ内容の再送では使い回し、内容を直したら作り直す（form.ts） */
export const createSubmissionId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
};
