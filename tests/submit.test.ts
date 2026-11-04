/**
 * 送信と応答の読み取り（submit.ts）
 * 元の実装のテストから、CF7 形式の応答に関する部分を抜き出したもの。fetch はテスト用の差し替え。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeCf7Response, postEntry, SUBMIT_TIMEOUT_MS } from '../src/entry/submit';

const url = '/mock/entry';
const body = () => new FormData();
const reply = (json: unknown, init: { ok?: boolean; status?: number } = {}) =>
  ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => json }) as Response;

afterEach(() => {
  vi.useRealTimers();
});

describe('postEntry', () => {
  it('reports success only when the reply says mail_sent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({ status: 'mail_sent' }));
    await expect(postEntry({ url, body: body(), fetchImpl })).resolves.toEqual({ kind: 'success' });
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['HTTP 500', () => Promise.resolve(reply({}, { ok: false, status: 500 }))],
    ['HTTP 200 without a status', () => Promise.resolve(reply({ ok: true }))],
    [
      'unreadable JSON',
      () =>
        Promise.resolve({
          ok: true,
          json: async () => {
            throw new SyntaxError('bad');
          },
        }),
    ],
  ])('classifies %s as a network error (no success without a valid reply)', async (_, impl) => {
    const fetchImpl = vi.fn(impl) as unknown as typeof fetch;
    await expect(postEntry({ url, body: body(), fetchImpl })).resolves.toEqual({ kind: 'network' });
  });

  it('aborts and reports a timeout when the server does not answer in time', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_: unknown, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    ) as unknown as typeof fetch;
    const pending = postEntry({ url, body: body(), fetchImpl });
    await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ kind: 'timeout' });
  });
});

describe('normalizeCf7Response', () => {
  it('returns field errors for validation_failed', () => {
    expect(
      normalizeCf7Response({
        status: 'validation_failed',
        invalid_fields: [{ field: 'job', message: '募集終了' }, { field: 1 }, null],
      })
    ).toEqual({ kind: 'invalid', fields: [{ field: 'job', message: '募集終了' }] });
  });

  it('passes a code for other statuses, falling back to the status', () => {
    expect(normalizeCf7Response({ status: 'spam', code: 'rate_limited', message: '時間をおいて' })).toEqual({
      kind: 'rejected',
      code: 'rate_limited',
      message: '時間をおいて',
    });
    expect(normalizeCf7Response({ status: 'mail_failed' })).toEqual({ kind: 'rejected', code: 'mail_failed', message: '' });
  });
});
