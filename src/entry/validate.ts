/**
 * 応募内容の入力検証（DOM に依存しない。テストで直接使う）
 *
 * 【ブラウザー側とサーバー側】
 *  ブラウザー側の検証は「送る前に気づいてもらう」ためのもので、改ざんや直接の送信は止められない。
 *  元の実装では、受付側（WordPress の PHP / 静的版の GAS）が同じ項目を検証し直している。
 *  このサンプルでは、ブラウザー（form.ts）とモックの送信先（mock/server.ts）の両方がこの関数を使う。
 *  職種の受付状態（募集中か）は送信時点の値で判定する必要があるため、ここでは扱わず jobs.ts の checkJob に分ける。
 *
 * 文字数の上限と文言は元の実装に合わせている（項目は公開用に 4 つへ絞った）。
 */

export const FIELDS = ['name', 'email', 'job', 'pr'] as const;
export type Field = (typeof FIELDS)[number];
export type EntryData = Record<Field, string>;
export type FieldErrors = Partial<Record<Field, string>>;

export const MAX_LENGTHS = { name: 50, email: 254, pr: 2000 } as const;

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export const JOB_REQUIRED_MESSAGE = '希望職種を選択してください。';

/** 1 行の項目: 制御文字と改行を除き、前後の空白を取る（メールの件名などへの改行の混入を防ぐ） */
export const cleanLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, '').trim();

/** 複数行の項目: 改行だけを残して制御文字を除く */
export const cleanText = (value: string) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim();

export const normalizeEntry = (raw: Partial<Record<Field, unknown>>): EntryData => {
  const text = (key: Field) => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  return {
    name: cleanLine(text('name')),
    email: cleanLine(text('email')),
    job: cleanLine(text('job')),
    pr: cleanText(text('pr')),
  };
};

const hasUrl = (value: string) => value.includes('://');

/** 項目ごとのエラー文言を返す（エラーが無ければ空のオブジェクト） */
export const validateEntry = (data: EntryData): FieldErrors => {
  const errors: FieldErrors = {};

  if (data.name === '') errors.name = 'お名前は必須です。';
  else if ([...data.name].length > MAX_LENGTHS.name) errors.name = 'お名前は50文字以内で入力してください。';
  else if (hasUrl(data.name)) errors.name = 'URL を含めることはできません。';

  if (data.email === '') errors.email = 'メールアドレスは必須です。';
  else if (data.email.length > MAX_LENGTHS.email) errors.email = 'メールアドレスが長すぎます。';
  else if (!EMAIL_PATTERN.test(data.email)) errors.email = 'メールアドレスが正しくありません（例：name@example.com）。';

  if (data.job === '') errors.job = JOB_REQUIRED_MESSAGE;

  if (data.pr === '') errors.pr = '自己PRは必須です。';
  else if ([...data.pr].length > MAX_LENGTHS.pr) errors.pr = '自己PRは2000文字以内で入力してください。';
  else if (hasUrl(data.pr)) errors.pr = 'URL を含めることはできません。';

  return errors;
};
