/**
 * 募集データの検証・URL・?job= の判定（jobs.ts）
 * resolveJobParam のケースは元の実装のテストから抜き出したもの。
 */
import { describe, expect, it } from 'vitest';
import { checkJob, entryUrl, detailUrl, parseJobs, resolveJobParam } from '../src/entry/jobs';
import { bundledJobs } from './helpers';

describe('parseJobs', () => {
  it('reads the bundled data and puts open jobs first', () => {
    const jobs = parseJobs(bundledJobs());
    expect(jobs.map(job => [job.id, job.open])).toEqual([
      ['consultant', true],
      ['sales', true],
      ['engineer', false],
    ]);
  });

  it('drops jobs whose id cannot be used for an application, and later duplicates', () => {
    const jobs = parseJobs({
      jobs: [
        { id: 'sales', name: '営業', open: true },
        { id: 'Sales Team', name: '不正な ID', open: true },
        { id: 'sales', name: '重複', open: true },
        { id: 'pm', open: true },
        { id: 'designer', name: 'デザイナー', open: 'yes' },
      ],
    });
    expect(jobs.map(job => [job.id, job.name, job.open])).toEqual([
      ['sales', '営業', true],
      // open は true のときだけ募集中（"yes" などの値を募集中とみなさない）
      ['designer', 'デザイナー', false],
    ]);
  });

  it.each([null, {}, { jobs: 'x' }])('returns an empty list for malformed data (%j)', raw => {
    expect(parseJobs(raw)).toEqual([]);
  });
});

describe('URLs carry the job id, not the display name', () => {
  it('builds the entry and detail links from the id', () => {
    expect(entryUrl('sales')).toBe('entry.html?job=sales');
    expect(detailUrl('sales')).toBe('job.html?id=sales');
    expect(entryUrl()).toBe('entry.html');
  });
});

describe('resolveJobParam (?job= on the entry form)', () => {
  const open = ['consultant', 'sales'];
  const closed = [{ id: 'engineer', name: 'システムエンジニア' }];

  it.each([null, ''])('no parameter (%j) leaves the form as is', value => {
    expect(resolveJobParam(value, open, closed)).toEqual({ status: 'none' });
  });
  it('preselects an open job', () => {
    expect(resolveJobParam('sales', open, closed)).toEqual({ status: 'open', id: 'sales' });
  });
  it('explains a closed job using the name from the data', () => {
    expect(resolveJobParam('engineer', open, closed)).toEqual({ status: 'closed', name: 'システムエンジニア' });
  });
  it.each(['designer', 'コンサルタント', 'CONSULTANT', '<script>', 'a'.repeat(65)])('rejects %s', value => {
    expect(resolveJobParam(value, open, closed)).toEqual({ status: 'invalid' });
  });
});

describe('checkJob (re-check at the receiving side)', () => {
  const jobs = parseJobs(bundledJobs());
  it('accepts an open job and tells closed from unknown', () => {
    expect(checkJob('sales', jobs).status).toBe('ok');
    expect(checkJob('engineer', jobs).status).toBe('closed');
    expect(checkJob('designer', jobs).status).toBe('invalid');
    expect(checkJob('ソリューション営業', jobs).status).toBe('invalid');
  });
});
