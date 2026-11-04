import './styles/main.scss';
import { setupEntryForm } from './entry/form';
import { loadJobs } from './entry/jobs';
import { createMockServer, type MockMode } from './mock/server';
import { setupJobsView } from './pages/jobs-view';

const jobsView = document.querySelector<HTMLElement>('.js-jobs-view');
if (jobsView) void setupJobsView(jobsView);

const entry = document.querySelector<HTMLElement>('.js-entry');
if (entry) void setupEntryWithMock(entry);

/**
 * 応募フォームを、モックの送信先につないで起動する（確認用）
 * 送信先と応答の切替は確認用の画面部品で、元サイトには無い。
 */
async function setupEntryWithMock(root: HTMLElement) {
  const panel = document.querySelector<HTMLElement>('.js-mock');
  const jobs = await loadJobs(root.dataset.jobsSrc ?? '').catch(() => []);
  const server = createMockServer(jobs, { latencyMs: 800 });

  const modeSelect = panel?.querySelector<HTMLSelectElement>('.js-mock-mode');
  const count = panel?.querySelector<HTMLElement>('.js-mock-count');
  const last = panel?.querySelector<HTMLElement>('.js-mock-last');
  const render = () => {
    const receipts = server.receipts();
    if (count) count.textContent = String(receipts.length);
    if (last) last.textContent = receipts.at(-1)?.jobId ?? '—';
  };
  modeSelect?.addEventListener('change', () => server.setMode(modeSelect.value as MockMode));
  render();

  await setupEntryForm(root, { fetchImpl: server.fetch, onSettled: render });
}
