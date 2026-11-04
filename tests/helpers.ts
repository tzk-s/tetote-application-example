import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 同梱の架空データ（public/data/jobs.json） */
export const bundledJobs = () => JSON.parse(fs.readFileSync(path.join(root, 'public/data/jobs.json'), 'utf8'));

/** 募集データの取得を差し替える。null を渡すと 404 */
export const jobsFetch = (data: unknown | null) =>
  (async () =>
    data === null
      ? new Response('Not Found', { status: 404 })
      : new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

/** HTML ファイルの body を document に入れる */
export const mountHtml = (file: string) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  document.body.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
};
