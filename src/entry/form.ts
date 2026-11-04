/**
 * 応募フォーム — 画面制御（公開用に作り直した最小構成）
 *
 * 【流れ】
 *  募集一覧 → 職種別詳細 →「この職種に応募」→ entry.html?job=<職種 ID> → 入力 → 送信 → 完了
 *
 * 【希望職種の選択肢】
 *  募集データの「募集中」の職種だけをラジオにする。?job= の許可リストはこのラジオの値そのもので、
 *  別のリストを持たない（持つと二重管理になる）。送信先も同じデータで、送信時点の受付状態を検証し直す。
 *
 * 【?job= の扱い】
 *  - 指定なし … 通常の応募フォーム
 *  - 募集中   … その職種を選択済みにする
 *  - 募集終了 … 理由（データ側の職種名）を案内し、選び直せるようにする
 *  - 不正     … URL の値は画面に出さず、選び直しを案内する
 *
 * 【入力内容の扱い】
 *  入力内容はフォームの要素自体とこのモジュールの変数（メモリ）にだけ持つ。
 *  localStorage などには保存しない。送信に失敗しても要素を書き換えないので、入力はそのまま残る。
 *
 * 【A11y】
 *  - エラーは項目の近くに出し、aria-invalid と aria-describedby で項目と結ぶ。最初のエラー項目へフォーカスする。
 *  - 送信中は文言・aria-busy・role="status" で伝える。disabled は使わず aria-disabled にする
 *    （disabled にするとフォーカスが外れ、「送信中…」の文言も読み上げられないため）。
 *  - 完了したら完了の見出しへフォーカスを移す。
 *
 * 元の実装（entryJob.js・formSubmit.js）は共通のフォーム基盤（エラーの吹き出し・確認画面など）に依存しているため、
 * ここでは同じ振る舞いをこのサンプル用に書き直している。
 */
import { loadJobs, resolveJobParam, type Job } from './jobs';
import {
  JOB_MESSAGES,
  SUBMIT_MESSAGES,
  SUBMIT_TIMEOUT_MS,
  createSubmissionId,
  postEntry,
  type SubmitResult,
} from './submit';
import { FIELDS, normalizeEntry, validateEntry, type Field, type FieldErrors } from './validate';

export const LOAD_ERROR_MESSAGE = '募集情報を読み込めませんでした。時間をおいて、ページを再読み込みしてください。';
export const NO_OPEN_JOBS_MESSAGE = '現在、募集中の職種はありません。';
const SUBMIT_LABEL_SUBMITTING = '送信中…';

export interface EntryFormOptions {
  /** 送信に使う fetch（確認用の画面ではモック、テストでは差し替え） */
  fetchImpl?: typeof fetch;
  /** 募集データの取得に使う fetch */
  loadImpl?: typeof fetch;
  /** ?job= を読む元（既定は現在の URL） */
  search?: string;
  /** 送信が終わるたびに呼ぶ（確認用の画面の表示更新） */
  onSettled?: (result: SubmitResult) => void;
}

export const setupEntryForm = async (root: HTMLElement, options: EntryFormOptions = {}) => {
  const form = root.querySelector<HTMLFormElement>('.js-entry-form');
  const loading = root.querySelector<HTMLElement>('.js-entry-loading');
  const options$ = root.querySelector<HTMLElement>('.js-entry-job-options');
  const complete = root.querySelector<HTMLElement>('.js-entry-complete');
  const { jobsSrc, endpoint = '' } = root.dataset;
  if (!form || !loading || !options$ || !complete || !jobsSrc) return;

  const timeoutMs = Number(root.dataset.timeoutMs) > 0 ? Number(root.dataset.timeoutMs) : SUBMIT_TIMEOUT_MS;
  const submitButton = form.querySelector<HTMLButtonElement>('.js-entry-submit');
  const submitError = form.querySelector<HTMLElement>('.js-entry-submit-error');
  const status = form.querySelector<HTMLElement>('.js-entry-status');
  const notice = form.querySelector<HTMLElement>('.js-entry-job-notice');
  const noticeText = form.querySelector<HTMLElement>('.js-entry-job-notice-text');
  const submissionInput = form.querySelector<HTMLInputElement>('input[name="submission-id"]');

  let jobs: Job[];
  try {
    jobs = await loadJobs(jobsSrc, options.loadImpl);
  } catch {
    loading.textContent = LOAD_ERROR_MESSAGE;
    return;
  }

  /* ---------- 希望職種の選択肢 ---------- */
  const openJobs = jobs.filter(job => job.open);
  const closedJobs = jobs.filter(job => !job.open);
  openJobs.forEach(job => {
    const label = document.createElement('label');
    label.className = 'c-choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'job';
    radio.value = job.id;
    radio.className = 'c-choice__input';
    radio.setAttribute('aria-describedby', 'job-error');
    const text = document.createElement('span');
    text.className = 'c-choice__label js-entry-job-label';
    text.textContent = job.name;
    label.append(radio, text);
    options$.append(label);
  });
  if (openJobs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'c-form-field__hint';
    empty.textContent = NO_OPEN_JOBS_MESSAGE;
    options$.append(empty);
  }

  const radios = () => [...form.querySelectorAll<HTMLInputElement>('input[name="job"]')];
  const firstEnabledRadio = () => radios().find(radio => !radio.disabled) ?? null;
  const fieldElements = (field: Field): HTMLElement[] =>
    field === 'job' ? radios() : [...form.querySelectorAll<HTMLElement>(`[name="${field}"]`)];
  const focusTarget = (field: Field): HTMLElement | null =>
    field === 'job' ? (radios().find(radio => radio.checked) ?? firstEnabledRadio()) : (fieldElements(field)[0] ?? null);

  /* ---------- 項目ごとのエラー ---------- */
  const setFieldError = (field: Field, message: string) => {
    const error = form.querySelector<HTMLElement>(`#${field}-error`);
    if (error) {
      error.textContent = message;
      error.hidden = message === '';
    }
    fieldElements(field).forEach(element => {
      element.setAttribute('aria-invalid', String(message !== ''));
      element.classList.toggle('is-error', message !== '');
    });
  };
  const clearErrors = () => FIELDS.forEach(field => setFieldError(field, ''));

  /** エラーを出し、DOM 上で最初のエラー項目へフォーカスする（並び順をエラーの順番に頼らない） */
  const showErrors = (errors: FieldErrors) => {
    clearErrors();
    const fields = FIELDS.filter(field => errors[field]);
    fields.forEach(field => setFieldError(field, errors[field] ?? ''));
    const targets = fields.map(focusTarget).filter((element): element is HTMLElement => element !== null);
    targets.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    targets[0]?.focus();
  };

  const showSubmitError = (text: string) => {
    if (!submitError) return;
    submitError.textContent = text;
    submitError.hidden = text === '';
  };

  //  直した項目のエラーは、その場で消す（他の項目のエラーは残す）
  form.addEventListener('input', event => {
    const name = (event.target as HTMLInputElement | null)?.name as Field | undefined;
    if (name && FIELDS.includes(name)) setFieldError(name, '');
  });
  form.addEventListener('change', event => {
    if ((event.target as HTMLInputElement | null)?.name === 'job') setFieldError('job', '');
  });

  /* ---------- 募集終了の扱い ---------- */
  const showNotice = (text: string) => {
    if (!notice || !noticeText) return;
    noticeText.textContent = text;
    notice.hidden = false;
  };

  /** 送信先から「募集終了」が返ったとき: その選択肢を選べなくし、項目の近くに理由を出す。他の入力には触れない */
  const markJobClosed = (jobId: string) => {
    const radio = radios().find(item => item.value === jobId);
    if (radio) {
      radio.checked = false;
      radio.disabled = true;
      const label = radio.closest('label')?.querySelector<HTMLElement>('.js-entry-job-label');
      if (label && !label.querySelector('.c-choice__badge')) {
        //  名前は残し、「募集終了」を文字で足す（色だけに頼らず、読み上げでも状態が伝わる）
        const badge = document.createElement('span');
        badge.className = 'c-choice__badge';
        badge.textContent = '募集終了';
        label.append(badge);
      }
    }
  };

  form.querySelector('.js-entry-job-focus')?.addEventListener('click', () => firstEnabledRadio()?.focus());

  const param = new URLSearchParams(options.search ?? window.location.search).get('job');
  const resolved = resolveJobParam(
    param,
    openJobs.map(job => job.id),
    closedJobs
  );
  if (resolved.status === 'open') {
    const radio = radios().find(item => item.value === resolved.id);
    if (radio) radio.checked = true;
  } else if (resolved.status === 'closed') {
    showNotice(JOB_MESSAGES.closed(resolved.name));
  } else if (resolved.status === 'invalid') {
    showNotice(JOB_MESSAGES.invalid);
  }

  /* ---------- 受付番号 ----------
     同じ内容で押し直した（タイムアウト後の再試行など）… 同じ番号 → 送信先が二重に受け付けない
     内容を直した … 新しい番号 → 別の応募として受け付ける
     比較用の内容はこの変数（メモリ）にだけ持つ */
  let lastSnapshot = '';
  const refreshSubmissionId = () => {
    if (!submissionInput) return;
    const snapshot = [...new FormData(form).entries()]
      .filter(([key]) => key !== 'submission-id')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&');
    if (!submissionInput.value || snapshot !== lastSnapshot) {
      submissionInput.value = createSubmissionId();
      lastSnapshot = snapshot;
    }
  };

  /* ---------- 送信中の表示 ---------- */
  let submitting = false;
  const setSubmitting = (on: boolean) => {
    submitting = on;
    if (on) form.setAttribute('aria-busy', 'true');
    else form.removeAttribute('aria-busy');
    if (submitButton) {
      if (!submitButton.dataset.labelDefault) submitButton.dataset.labelDefault = submitButton.textContent?.trim() ?? '';
      submitButton.textContent = on ? SUBMIT_LABEL_SUBMITTING : submitButton.dataset.labelDefault;
      submitButton.setAttribute('aria-disabled', String(on));
    }
    if (status) {
      status.textContent = on ? SUBMIT_MESSAGES.submitting : '';
      status.hidden = !on;
    }
  };

  const showComplete = () => {
    //  完了後は入力内容を画面から消す（戻る操作などで他人に見られないように）
    form.reset();
    lastSnapshot = '';
    if (submissionInput) submissionInput.value = '';
    form.hidden = true;
    notice?.setAttribute('hidden', '');
    complete.hidden = false;
    complete.querySelector<HTMLElement>('.js-entry-complete-heading')?.focus();
  };

  const handleResult = (result: SubmitResult) => {
    if (result.kind === 'success') {
      showComplete();
      return;
    }
    if (result.kind === 'timeout') return showSubmitError(SUBMIT_MESSAGES.timeout);
    if (result.kind === 'network') return showSubmitError(SUBMIT_MESSAGES.network);
    if (result.kind === 'rejected') {
      //  送信先の文言は、利用者向けの日本語のときだけ出す（英語のエラーや技術情報は出さない）
      return showSubmitError(/[ぁ-んァ-ン一-龥]/.test(result.message) ? result.message : SUBMIT_MESSAGES.fallback);
    }
    //  入力エラー（送信先の検証）。希望職種が送信直前に募集終了になっていたら、その選択肢を選べなくする
    const errors: FieldErrors = {};
    result.fields.forEach(({ field, message }) => {
      if (!FIELDS.includes(field as Field)) return;
      if (field === 'job' && message === JOB_MESSAGES.closedOnSubmit) {
        const selected = radios().find(radio => radio.checked);
        if (selected) markJobClosed(selected.value);
      }
      errors[field as Field] = message || SUBMIT_MESSAGES.invalid;
    });
    showErrors(errors);
    showSubmitError(SUBMIT_MESSAGES.invalid);
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    //  送信中の押し直しは無視する（aria-disabled はクリック自体を止めないため、ここで止める）
    if (submitting) return;
    showSubmitError('');

    const formData = new FormData(form);
    const data = normalizeEntry({
      name: formData.get('name'),
      email: formData.get('email'),
      job: formData.get('job'),
      pr: formData.get('pr'),
    });
    const errors = validateEntry(data);
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }
    clearErrors();

    refreshSubmissionId();
    setSubmitting(true);
    const result = await postEntry({
      url: endpoint,
      body: new FormData(form),
      fetchImpl: options.fetchImpl,
      timeoutMs,
    });
    setSubmitting(false);
    handleResult(result);
    options.onSettled?.(result);
  });

  loading.hidden = true;
  form.hidden = false;
};
