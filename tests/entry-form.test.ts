// @vitest-environment jsdom
/**
 * 応募フォームの画面操作（form.ts）
 *
 * entry.html のマークアップをそのまま読み込み、利用者が確認できる挙動を確かめる:
 *  - 詳細から引き継いだ職種が選択済みになり、送信値が表示名ではなく職種 ID であること
 *  - 職種指定なし・不正な ID・募集終了の ID での案内
 *  - 未入力時のエラー表示と、最初のエラー項目へのフォーカス
 *  - 送信直前の募集終了・送信失敗・タイムアウトで入力内容が残ること、再試行で二重に受け付けないこと
 *  - 送信中の押し直しで二重に送らないこと
 * 送信先はモック（mock/server.ts）で、実際の送信は行わない。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJobs } from '../src/entry/jobs';
import { JOB_MESSAGES, SUBMIT_MESSAGES } from '../src/entry/submit';
import { LOAD_ERROR_MESSAGE, setupEntryForm } from '../src/entry/form';
import { createMockServer, type MockMode } from '../src/mock/server';
import { bundledJobs, jobsFetch, mountHtml } from './helpers';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector) as T;
const radio = (id: string) => $<HTMLInputElement>(`input[name="job"][value="${id}"]`);
const form = () => $<HTMLFormElement>('.js-entry-form');

const mount = async ({ search = '', mode = 'success' as MockMode, data = bundledJobs() as unknown } = {}) => {
  mountHtml('entry.html');
  const server = createMockServer(parseJobs(bundledJobs()));
  server.setMode(mode);
  const sent: FormData[] = [];
  const fetchImpl = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(init?.body as FormData);
    return server.fetch(url, init);
  }) as unknown as typeof fetch;
  await setupEntryForm($('.js-entry'), { fetchImpl, loadImpl: jobsFetch(data), search });
  return { server, sent, fetchImpl };
};

const fill = ({ name = '架空 太郎', email = 'taro@example.com', pr = 'よろしくお願いします。' } = {}) => {
  $<HTMLInputElement>('#name').value = name;
  $<HTMLInputElement>('#email').value = email;
  $<HTMLTextAreaElement>('#pr').value = pr;
};

/** 送信して、送信処理が終わるまで待つ */
const submit = async () => {
  form().requestSubmit();
  await vi.waitFor(() => expect(form().hasAttribute('aria-busy')).toBe(false));
};

afterEach(() => {
  vi.useRealTimers();
});

describe('job from the detail page (?job=)', () => {
  it('preselects the job and sends its fixed id, not the display name', async () => {
    const { sent, server } = await mount({ search: '?job=sales' });
    expect(radio('sales').checked).toBe(true);
    expect($('.js-entry-job-notice').hidden).toBe(true);

    fill();
    await submit();

    expect(sent).toHaveLength(1);
    expect(sent[0].get('job')).toBe('sales');
    expect(server.receipts()).toEqual([{ submissionId: sent[0].get('submission-id'), jobId: 'sales' }]);
    expect($('.js-entry-complete').hidden).toBe(false);
    expect(document.activeElement).toBe($('.js-entry-complete-heading'));
  });

  it('works without a job parameter and lists only open jobs', async () => {
    await mount();
    const values = [...document.querySelectorAll<HTMLInputElement>('input[name="job"]')].map(item => item.value);
    expect(values).toEqual(['consultant', 'sales']);
    expect(values.some(value => radio(value).checked)).toBe(false);
    expect($('.js-entry-job-notice').hidden).toBe(true);
  });

  it('explains an unknown id without echoing it, and lets the user choose again', async () => {
    await mount({ search: '?job=%3Cscript%3E' });
    const notice = $('.js-entry-job-notice');
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain(JOB_MESSAGES.invalid);
    expect(notice.textContent).not.toContain('script');

    $('.js-entry-job-focus').click();
    expect(document.activeElement).toBe(radio('consultant'));
  });

  it('names a closed job from the data and does not preselect anything', async () => {
    await mount({ search: '?job=engineer' });
    expect($('.js-entry-job-notice-text').textContent).toBe(JOB_MESSAGES.closed('システムエンジニア'));
    expect(document.querySelector('input[name="job"][value="engineer"]')).toBeNull();
    expect(document.querySelector('input[name="job"]:checked')).toBeNull();
  });

  it('tells the user when the jobs cannot be loaded and does not show the form', async () => {
    await mount({ data: null });
    expect($('.js-entry-loading').textContent).toBe(LOAD_ERROR_MESSAGE);
    expect(form().hidden).toBe(true);
  });
});

describe('input errors', () => {
  it('shows each error next to its field and focuses the first one', async () => {
    const { sent } = await mount();
    fill({ name: '', email: 'not-an-email', pr: '' });
    form().requestSubmit();

    expect(sent).toHaveLength(0);
    expect($('#name-error').hidden).toBe(false);
    expect($('#name').getAttribute('aria-invalid')).toBe('true');
    expect($('#name').getAttribute('aria-describedby')).toContain('name-error');
    expect($('#email-error').textContent).toContain('正しくありません');
    expect($('#job-error').textContent).toBe('希望職種を選択してください。');
    expect(radio('consultant').getAttribute('aria-invalid')).toBe('true');
    expect($('#pr-error').hidden).toBe(false);
    expect(document.activeElement).toBe($('#name'));
  });

  it('focuses the job choices when that is the only error, and clears the error once chosen', async () => {
    await mount();
    fill();
    form().requestSubmit();
    expect(document.activeElement).toBe(radio('consultant'));

    radio('sales').click();
    expect($('#job-error').hidden).toBe(true);
    expect(radio('sales').getAttribute('aria-invalid')).toBe('false');
  });
});

describe('sending', () => {
  it('keeps the input and moves to the job choices when the job closes just before sending', async () => {
    const { server } = await mount({ search: '?job=sales', mode: 'close-job' });
    fill();
    await submit();

    expect(radio('sales').disabled).toBe(true);
    expect(radio('sales').checked).toBe(false);
    expect(radio('sales').closest('label')?.textContent).toContain('募集終了');
    expect($('#job-error').textContent).toBe(JOB_MESSAGES.closedOnSubmit);
    expect(document.activeElement).toBe(radio('consultant'));
    // 他の入力はそのまま残る
    expect($<HTMLInputElement>('#name').value).toBe('架空 太郎');
    expect($<HTMLTextAreaElement>('#pr').value).toBe('よろしくお願いします。');
    expect(server.receipts()).toEqual([]);

    // 別の職種を選び直せば、入力し直さずに送れる
    server.setMode('success');
    radio('consultant').click();
    await submit();
    expect(server.receipts().map(item => item.jobId)).toEqual(['consultant']);
  });

  it('keeps the input and explains how to retry when the server fails', async () => {
    const { server } = await mount({ search: '?job=sales', mode: 'server-error' });
    fill();
    await submit();

    expect($('.js-entry-submit-error').textContent).toBe(SUBMIT_MESSAGES.network);
    expect($('.js-entry-complete').hidden).toBe(true);
    expect($<HTMLInputElement>('#email').value).toBe('taro@example.com');
    expect(radio('sales').checked).toBe(true);

    server.setMode('success');
    await submit();
    expect($('.js-entry-complete').hidden).toBe(false);
  });

  it('does not create a second application when retrying after a timeout', async () => {
    vi.useFakeTimers();
    const { server, sent } = await mount({ search: '?job=sales', mode: 'timeout' });
    fill();
    form().requestSubmit();
    await vi.advanceTimersByTimeAsync(8000);

    expect($('.js-entry-submit-error').textContent).toBe(SUBMIT_MESSAGES.timeout);
    expect($<HTMLInputElement>('#name').value).toBe('架空 太郎');
    // 送信先では受付が済んでいた
    expect(server.receipts()).toHaveLength(1);

    server.setMode('success');
    form().requestSubmit();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect($('.js-entry-complete').hidden).toBe(false));

    expect(sent[1].get('submission-id')).toBe(sent[0].get('submission-id'));
    expect(server.receipts()).toHaveLength(1);
  });

  it('uses a new submission id when the input was changed before resending', async () => {
    const { server, sent } = await mount({ search: '?job=sales', mode: 'server-error' });
    fill();
    await submit();
    $<HTMLTextAreaElement>('#pr').value = '内容を直しました。';
    server.setMode('success');
    await submit();
    expect(sent[1].get('submission-id')).not.toBe(sent[0].get('submission-id'));
  });

  it('shows the sending state and ignores repeated presses while sending', async () => {
    const { fetchImpl } = await mount({ search: '?job=sales' });
    fill();
    const button = $<HTMLButtonElement>('.js-entry-submit');
    form().requestSubmit();
    form().requestSubmit();
    button.click();

    expect(button.textContent).toBe('送信中…');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(form().getAttribute('aria-busy')).toBe('true');
    expect($('.js-entry-status').textContent).toBe(SUBMIT_MESSAGES.submitting);

    await vi.waitFor(() => expect($('.js-entry-complete').hidden).toBe(false));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clears the entered values from the page after a successful send', async () => {
    await mount({ search: '?job=sales' });
    fill();
    await submit();
    expect($<HTMLInputElement>('#name').value).toBe('');
    expect($<HTMLInputElement>('input[name="submission-id"]').value).toBe('');
  });
});
