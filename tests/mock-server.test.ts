/**
 * モックの送信先（mock/server.ts）
 * 受付側で行う検証（入力項目・職種 ID・送信時点の受付状態・同じ受付番号の再送）を、モックで再現できているか。
 * 実環境の受付側（WordPress の PHP / GAS）の検証ではない。
 */
import { describe, expect, it } from 'vitest';
import { parseJobs } from '../src/entry/jobs';
import { JOB_MESSAGES } from '../src/entry/submit';
import { createMockServer } from '../src/mock/server';
import { bundledJobs } from './helpers';

const ID = '0f8e0c1c-1111-4222-8333-944455556666';
const entry = (overrides: Record<string, string> = {}) => {
  const body = new FormData();
  const values = { name: '架空 太郎', email: 'taro@example.com', job: 'sales', pr: 'よろしくお願いします。', 'submission-id': ID, ...overrides };
  Object.entries(values).forEach(([key, value]) => body.append(key, value));
  return body;
};
const send = async (server: ReturnType<typeof createMockServer>, body: FormData) =>
  (await server.fetch('/mock/entry', { method: 'POST', body })).json();

describe('mock receiving side', () => {
  it('accepts an open job and records only the submission id and job id', async () => {
    const server = createMockServer(parseJobs(bundledJobs()));
    await expect(send(server, entry())).resolves.toEqual({ status: 'mail_sent' });
    expect(server.receipts()).toEqual([{ submissionId: ID, jobId: 'sales' }]);
  });

  it.each([
    ['engineer', JOB_MESSAGES.closedOnSubmit],
    ['designer', JOB_MESSAGES.invalidOnSubmit],
    ['ソリューション営業', JOB_MESSAGES.invalidOnSubmit],
  ])('rejects job %s even if the browser check was skipped', async (job, message) => {
    const server = createMockServer(parseJobs(bundledJobs()));
    await expect(send(server, entry({ job }))).resolves.toEqual({
      status: 'validation_failed',
      invalid_fields: [{ field: 'job', message }],
    });
    expect(server.receipts()).toEqual([]);
  });

  it('re-validates the fields and strips line breaks from single-line fields', async () => {
    const server = createMockServer(parseJobs(bundledJobs()));
    const result = await send(server, entry({ name: '', email: 'taro@example.com\nBcc: x@example.com', pr: 'https://example.com' }));
    expect(result.status).toBe('validation_failed');
    expect(result.invalid_fields.map((item: { field: string }) => item.field)).toEqual(['name', 'email', 'pr']);
  });

  it('closes the selected job just before receiving in close-job mode', async () => {
    const server = createMockServer(parseJobs(bundledJobs()));
    server.setMode('close-job');
    const result = await send(server, entry());
    expect(result.invalid_fields).toEqual([{ field: 'job', message: JOB_MESSAGES.closedOnSubmit }]);
    expect(server.jobs().find(job => job.id === 'sales')?.open).toBe(false);
  });

  it('receives the same submission id only once (retry after a timeout)', async () => {
    const server = createMockServer(parseJobs(bundledJobs()));
    await send(server, entry());
    await expect(send(server, entry())).resolves.toEqual({ status: 'mail_sent', code: 'duplicate' });
    await send(server, entry({ 'submission-id': '1f8e0c1c-1111-4222-8333-944455556666' }));
    expect(server.receipts()).toHaveLength(2);
  });

  it('returns HTTP 500 without receiving in server-error mode', async () => {
    const server = createMockServer(parseJobs(bundledJobs()));
    server.setMode('server-error');
    const res = await server.fetch('/mock/entry', { method: 'POST', body: entry() });
    expect(res.status).toBe(500);
    expect(server.receipts()).toEqual([]);
  });
});
