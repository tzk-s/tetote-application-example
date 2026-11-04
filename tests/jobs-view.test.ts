// @vitest-environment jsdom
/**
 * 募集一覧・職種別詳細（pages/jobs-view.ts）
 * 応募フォームと同じ募集データから描画され、募集終了の表示と応募の入口が食い違わないこと。
 */
import { describe, expect, it } from 'vitest';
import { NOT_FOUND_MESSAGE, setupJobsView } from '../src/pages/jobs-view';
import { bundledJobs, jobsFetch, mountHtml } from './helpers';

const mount = async (file: string, search = '') => {
  mountHtml(file);
  const root = document.querySelector<HTMLElement>('.js-jobs-view') as HTMLElement;
  await setupJobsView(root, { loadImpl: jobsFetch(bundledJobs()), search });
  return root;
};
const hrefs = (root: HTMLElement) => [...root.querySelectorAll('a')].map(a => a.getAttribute('href'));

describe('job list', () => {
  it('links open jobs to the entry form by id and shows no entry link for a closed job', async () => {
    const root = await mount('index.html');
    const items = [...root.querySelectorAll('.p-jobs__item')];
    expect(items.map(item => item.querySelector('h2')?.textContent)).toEqual([
      'コンサルタント',
      'ソリューション営業',
      'システムエンジニア募集終了',
    ]);
    expect(hrefs(items[1] as HTMLElement)).toEqual(['job.html?id=sales', 'entry.html?job=sales']);
    expect(hrefs(items[2] as HTMLElement)).toEqual(['job.html?id=engineer']);
    expect(items[2].textContent).toContain('この職種の募集は終了しました。');
    expect(hrefs(root)).toContain('entry.html');
  });
});

describe('job detail', () => {
  it('shows the requirements and an entry link that carries the id', async () => {
    const root = await mount('job.html', '?id=consultant');
    expect(root.querySelector('h2')?.textContent).toBe('コンサルタント');
    expect([...root.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual([
      '職種名',
      '業務内容',
      '応募条件',
      '雇用形態',
      '勤務地',
      '勤務時間',
      '給与',
      '休日',
      '選考フロー',
    ]);
    expect(hrefs(root)).toContain('entry.html?job=consultant');
  });

  it('keeps a closed job page but explains it and offers no entry link', async () => {
    const root = await mount('job.html', '?id=engineer');
    expect(root.textContent).toContain('この職種の募集は終了しました');
    expect(hrefs(root)).toContain('index.html');
    expect(hrefs(root).some(href => href?.startsWith('entry.html'))).toBe(false);
  });

  it('shows a not-found message for an unknown id', async () => {
    const root = await mount('job.html', '?id=designer');
    expect(root.textContent).toContain(NOT_FOUND_MESSAGE);
  });
});
