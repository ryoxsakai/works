// Store navigation preferences only, never form text or role content.
export function createWorkflowSteps({ root, state, showDialog, closeDialog }) {
  const $ = (selector) => root.querySelector(selector);
  const key = 'works_workflow_guide_v1';
  let initialized = false, step = 2, guiding = false, guideStep = 1;
  function read() {
    try {
      const value = JSON.parse(sessionStorage.getItem(key));
      return value && Number.isInteger(value.step) && value.step >= 1 &&
        value.step <= 3 && typeof value.guiding === 'boolean' ? value : null;
    } catch { return null; }
  }
  function save() {
    try { sessionStorage.setItem(key, JSON.stringify({ step: guideStep, guiding })); }
    catch { /* Navigation still works when browser storage is unavailable. */ }
  }
  function select(next, { focus = true } = {}) {
    step = next;
    if (guiding) guideStep = step;
    for (let i = 1; i <= 3; i++) {
      $('#step-' + i).hidden = i !== step;
      $(`[data-step="${i}"]`).setAttribute('aria-current', i === step ? 'step' : 'false');
    }
    $('#setup-guide').hidden = !guiding;
    $('#setup-back').disabled = step === 1;
    $('#setup-next').textContent = step === 3 ? 'ガイドを終えてカンバンへ' : '次へ';
    $('#setup-help').textContent = {
      1: '1 / 3：まず担当の責任・操作範囲・完了条件を登録します。既存の担当も使えます。あとで設定して次へ進むこともできます。',
      2: '2 / 3：仕事と直列工程を下書きします。「定義・実行許可」で内容を確認してから承認します。作成や承認はガイドと別の操作です。',
      3: '3 / 3：本人の確認待ち・停止中の仕事を確認します。必要な証拠と完了条件を確認してから、各実行の操作を選びます。',
    }[step];
    save();
    if (focus) $('#step-' + step).querySelector('h2').focus();
  }
  for (const button of root.querySelectorAll('[data-step]')) {
    button.onclick = () => select(Number(button.dataset.step));
  }
  $('#resume-setup').onclick = () => { guiding = true; select(guideStep); };
  $('#setup-back').onclick = () => select(Math.max(1, step - 1));
  $('#setup-next').onclick = () => {
    if (step === 3) { guiding = false; select(2); }
    else select(step + 1);
  };
  $('#setup-cancel').onclick = () => { guiding = false; select(2); };
  for (const button of root.querySelectorAll('[data-open]')) {
    button.onclick = () => {
      const dialog = $('#' + button.dataset.open);
      dialog.querySelector('.wf-dialog-error')?.remove();
      showDialog(dialog);
    };
  }
  $('#show-history').onclick = () => {
    closeDialog($('#history-dialog'));
    select(2);
    [...$('#filters').querySelectorAll('button')]
      .find(button => button.textContent.startsWith('完了 '))?.click();
  };
  return {
    render() {
      const data = state();
      if (!initialized) {
        const previous = read();
        guideStep = previous?.step || 1;
        guiding = previous?.guiding ?? !(data.definitions.length || data.roles?.some(role => !role.archived));
        initialized = true;
        select(guiding ? guideStep : 2, { focus: false });
      }
      $('#board-empty').hidden = !!data.definitions.length;
      const review = data.runs.filter(run => run.status === 'review').length;
      $('#review-count').textContent = review ? `（確認待ち ${review}件）` : '';
      $('#safety-status').textContent =
        (data.settings.stopped ? '全体停止中。再開には本人の確認が必要です。' : '') +
        (review ? ` 本人の確認待ち ${review}件。3. 確認事項で確認してください。` : '');
    },
    select,
    reset() { initialized = false; },
  };
}
