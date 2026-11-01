import {pendingRecoveryCopies} from '../tutor/pending-plan-draft.mjs?v=1';
// Shared record-card markup; identity, attribution and persistence stay with owners.
import {attributedLessonRecord} from './lesson-attribution.js';
import {lessonEventRef,sameLessonEvent} from './lesson-plan.js';
export function sameLessonOwner(current,previous){
  if(current?.record_storage!=='d1_owner')return previous?.record_storage!=='d1_owner';
  return current.attribution_status==='confirmed'&&previous?.record_storage==='d1_owner'&&previous.attribution_status==='confirmed'&&!!current.owner_id&&current.owner_id===previous.owner_id;
}
export function previousOwnerRecord(current,event,events,readRecord){
  current=attributedLessonRecord(current,lessonEventRef(event));
  if(current?.record_storage!=='d1_owner'||current.attribution_status!=='confirmed'||!current.owner_id)return null;
  const start=Date.parse(event.start?.dateTime||event.start?.date||event.start);
  return events.map(candidate=>({event:candidate,record:readRecord(candidate),time:Date.parse(candidate.start?.dateTime||candidate.start?.date||candidate.start)}))
    .filter(candidate=>Number.isFinite(candidate.time)&&candidate.time<start&&sameLessonOwner(current,candidate.record))
    .sort((a,b)=>b.time-a.time)[0]||null;
}
export function lessonRecordRows(rows, { escapeHtml, formatTimeOrPeriod, lessonRecordNeedsReview, lessonReviewRow, lightenHexColor, calendarName, lessonAttributionNotice, lessonPlanEditor, lessonPlanFeedback, recordStudentPrefName, lessonEventKey }) {
  const card=(html,r)=>html.replace(/^<tr(?=[\s>])/,`<tr data-record-card data-card-key="${escapeHtml(r.ref?lessonEventKey(r.ref):r.eventId||r.start||'')}"`);
  return rows
    .map((r) => {
      if (r.emptySlot) {
        const accent = r.iconColor ? ` style="--record-calendar-accent:${escapeHtml(r.iconColor)}"` : "";
        return card(`<tr class="record-empty-slot"${accent}>
          <td colspan="2"><span class="record-empty-label"><i class="bx bx-calendar"></i> 空き <small>${escapeHtml(r.calendarName)}</small></span></td>
          <td class="record-empty-time">${formatTimeOrPeriod(r.start, "Asia/Tokyo")}</td>
          <td colspan="4"></td>
        </tr>`,r);
      }
      const record=r.record?.record_storage==='d1_owner'?attributedLessonRecord(r.record,r.ref):r.record;
      if (lessonRecordNeedsReview(record)) return card(lessonReviewRow(r.ref,record,r.label,formatTimeOrPeriod(r.start,"Asia/Tokyo")),r);
      return card(`<tr data-event-id="${escapeHtml(r.eventId)}" data-record-ref="${escapeHtml(JSON.stringify(r.ref))}" data-record-revision="${r.record.record_revision}" data-record-owner="${escapeHtml(r.record.owner_id||'')}" data-completed="${r.completed ? 1 : 0}" data-calendar-name="${escapeHtml(calendarName(r.calendarId) || "カレンダー")}">
        <td>
          <div class="record-card-heading"><button type="button" class="record-student-link" data-calendar-id="${escapeHtml(r.calendarId || "")}" data-name="${escapeHtml(r.label)}" data-term-id="${r.termId}"><span class="record-avatar"${r.iconColor ? ` style="background-color:${escapeHtml(lightenHexColor(r.iconColor, 0.75))};color:${escapeHtml(r.iconColor)}"` : ""}><i class="bx bx-book-open"></i></span> ${escapeHtml(r.label)}</button><div class="record-card-meta"><span>${r.n}/${r.m}回</span><span>${formatTimeOrPeriod(r.start, "Asia/Tokyo")}</span><button type="button" class="record-recheck btn btn-outline" aria-label="予定を再確認" title="予定を再確認" disabled><svg class="works-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></svg></button></div></div>
          ${lessonAttributionNotice(r.record)}
          ${
            r.prevLessonPlan&&sameLessonOwner(r.record,r.prevRecord)&&!lessonRecordNeedsReview(r.prevRecord)
              ? `<div class="record-prev-info">${lessonAttributionNotice(r.prevRecord)}
                  ${r.prevLessonPlan ? `<p><i class="bx bx-book-content"></i> ${escapeHtml(r.prevLessonPlan)}</p>` : ""}
                </div>`
              : ""
          }
        </td>
        <td data-label="回数">${r.n}/${r.m}回</td>
        <td data-label="時刻">${formatTimeOrPeriod(r.start, "Asia/Tokyo")}</td>
        <td data-label="授業予定">${lessonPlanEditor(r.ref, r.label, "record-plan",r.record.owner_id||"")}</td>
        <td data-label="確認テスト"><textarea class="record-test" rows="1" aria-label="${escapeHtml(r.label)}の確認テスト">${escapeHtml(r.confirmationTest)}</textarea></td>
        <td data-label="宿題"><textarea class="record-homework" rows="1" aria-label="${escapeHtml(r.label)}の宿題">${escapeHtml(r.homework)}</textarea></td>
        <td data-label="授業メモ"><textarea class="record-memo" rows="1" aria-label="${escapeHtml(r.label)}の授業メモ">${escapeHtml(r.lessonMemo)}</textarea>
          <div class="record-next-plan lesson-plan-editor" data-source-key="${escapeHtml(lessonEventKey(r.ref))}">
            <label>次回授業予定<textarea class="linked-lesson-plan" rows="1" maxlength="5000" aria-label="${escapeHtml(r.label)}の次回授業予定" disabled></textarea></label>
            <small class="lesson-plan-target"></small>
            ${lessonPlanFeedback()}
          </div>
          <div class="record-student-memo student-memo-editor" data-student-name="${escapeHtml(recordStudentPrefName(r.label))}">
            <label>生徒メモ<textarea class="student-memo-input" rows="1" aria-label="${escapeHtml(r.label)}の生徒メモ" placeholder="日付をまたいで共有" disabled></textarea></label>
            <div class="student-memo-feedback"><small class="student-memo-status" role="status" aria-live="polite"></small><button type="button" class="student-memo-retry" hidden>再試行</button></div>
          </div>
        </td>
      </tr>`,r);
    })
    .join("");
}

export function renderPlanEditors(root, lessonPlans, { lessonPlanDate, resizeRecordInput }) {
  const states = { unsaved: "未保存・入力を終えると自動保存", saving: "保存中…", saved: "保存済み", error: "保存できませんでした。入力は残っています", conflict: "予定または内容が変更されています。入力を残して保存を停止しました" };
  const reasons = { owner_confirmation_required: "次回候補は見つかりました。生徒・クラスの紐づけを確認してください", owner_unassigned: "この授業の生徒・クラスの紐づけを確認してください", attribution: "次回の記録は予定名の対応確認が必要です。次回授業の授業記録画面で確認してください", loading: "次回を確認中…", none: "366日先までに次回の授業が見つかりません", ineligible: "この予定は次回連動の対象外です", ambiguous: "同時刻に候補が複数あるため連動できません", error: "次回を取得できませんでした", conflict: states.conflict };
  root.querySelectorAll(".lesson-plan-editor").forEach((editor) => {
    const sourceKey = editor.dataset.sourceKey;
    const link = sourceKey ? lessonPlans.getLink(sourceKey) : null;
    if (sourceKey) editor.dataset.planKey = link?.targetKey || "";
    const key = editor.dataset.planKey, state = lessonPlans.get(key);
    const input = editor.querySelector("textarea"), status = editor.querySelector(".lesson-plan-status"), action = editor.querySelector(".lesson-plan-action");
    const readTarget=editor.dataset.readTarget?JSON.parse(editor.dataset.readTarget):null;
    const changedObservation=!!(readTarget&&state&&(!sameLessonEvent(state.target,readTarget)||(editor.dataset.readOwner||null)!==(state.ownerId||null)));
    editor.querySelector('.retained-plan-draft')?.remove();
    editor.querySelector('.next-owner-review')?.remove();
    if(changedObservation){
      input.value='';input.disabled=true;status.textContent='予定の変更を検出しました。以前の入力を保持して編集を停止しています。';action.hidden=true;action.disabled=true;
      if(state.dirty){const retained=editor.ownerDocument.createElement('details'),label=editor.ownerDocument.createElement('summary'),body=editor.ownerDocument.createElement('pre');retained.className='retained-plan-draft';label.textContent='以前の予定の未保存入力：'+state.target.title+' / '+state.target.start;body.textContent=state.value;retained.append(label,body);editor.append(retained);}
      return;
    }
    const linkStatus = link?.status || "loading";
    const reviewRequired=['owner_confirmation_required','pending_owner'].includes(linkStatus);
    const pendingState=!!state?.pendingContext;
    const conflict = state?.status === "conflict" || (sourceKey && linkStatus === "conflict");
    input.disabled = !state;
    input.readOnly = !!conflict || !!(sourceKey && !['ready','pending_owner'].includes(linkStatus));
    input.hidden = !!sourceKey && !state;
    if (input.value !== (state?.value || "")) input.value = state?.value || "";
    const pendingMessages={ready:'未紐づけの予定下書きです。入力後にD1へ保存します',unsaved:'下書き未保存・入力を終えるとD1へ保存',saving:'未紐づけ下書きをD1へ保存中…',saved:'未紐づけ下書きをD1へ保存しました。帰属は未確定です',error:'下書きをD1へ保存できませんでした。入力を保持しています',conflict:state?.pendingUnknown?'下書きの保存結果が不明です。再送せず操作IDで照合してください':'予定・紐づけ・下書きが変更されました。入力を保持して保存を停止しました'};
    const message = pendingState?pendingMessages[state?.pending?'saving':state?.status]:sourceKey && linkStatus !== "ready" ? reasons[linkStatus] : states[state?.pending ? "saving" : state?.status];
    status.textContent = (message || "")+(state?.operationId?' 操作ID: '+state.operationId:'')+(state?.message&&state.status==='conflict'?' '+state.message:'')+(state?.recoveryUnavailable?' この端末への復旧コピーを保存できません。D1保存を確認するまで画面を閉じないでください':'');
    status.dataset.error = String(!!conflict || state?.status === "error" || (sourceKey && linkStatus === "error"));
    if (sourceKey) {
      const target = conflict ? link?.current?.target || link?.target : link?.target;
      editor.querySelector(".lesson-plan-target").dataset.conflict = String(!!conflict);
      editor.querySelector(".lesson-plan-target").dataset.review = String(reviewRequired);
      if(reviewRequired&&target){const review=editor.ownerDocument.createElement('a');review.className='next-owner-review';review.textContent='次回候補の紐づけを確認';review.inert=!!state?.pendingUnknown;review.setAttribute('aria-disabled',String(!!state?.pendingUnknown));review.href='/tutor/history.html?'+new URLSearchParams({calendar_id:target.calendar_id,event_id:target.id});editor.append(review);}
      editor.querySelector(".lesson-plan-target").textContent = target ? `${conflict ? "最新候補" : reviewRequired ? "次回候補" : "連動先"}: ${lessonPlanDate(target)}` : "";
    }
    action.hidden = false; action.disabled = !!state?.pending || linkStatus === "loading" && !!sourceKey;
    if(state?.pendingUnknown){action.dataset.action='verify-pending';action.textContent='操作IDで保存結果だけを照合';}
    else if (conflict) { action.dataset.action = "reload"; action.textContent = state?.dirty ? "入力を破棄して予定を再確認" : "予定を再読み込み"; }
    else if (state?.status === "error") { action.dataset.action = "retry"; action.textContent = "再保存"; }
    else if (sourceKey) { action.dataset.action = "recheck"; action.textContent = "予定を再確認"; }
    else if(pendingState){action.dataset.action='retry';action.textContent='下書きをD1へ保存';action.hidden=!state.dirty;}
    else action.hidden = true;
    const refresh = editor.closest("tr[data-event-id]")?.querySelector(".record-recheck");
    if (sourceKey && refresh) refresh.disabled = action.disabled || action.dataset.action !== "recheck";
    const binding=editor.closest('tr')?.querySelector('.pending-bind-link');if(binding){binding.inert=!!state?.pendingUnknown;binding.setAttribute('aria-disabled',String(!!state?.pendingUnknown));}
    resizeRecordInput(input);
  });
  const table=root.querySelector?.('#record-tbody')||root.closest?.('tbody');const host=table?.closest('.table-scroll');
  if(host){
    let panel=host.querySelector('.pending-recovery-copies');if(!panel){panel=host.ownerDocument.createElement('aside');panel.className='pending-recovery-copies';host.prepend(panel);}panel.replaceChildren();
    const visible=new Set([...root.querySelectorAll('.lesson-plan-editor')].map(el=>lessonPlans.get(el.dataset.planKey)?.pendingContext).filter(Boolean));
    for(const draft of pendingRecoveryCopies().filter(d=>!d.currentTab||!visible.has(d.context))){
      const details=host.ownerDocument.createElement('details'),title=host.ownerDocument.createElement('summary'),notice=host.ownerDocument.createElement('p'),body=host.ownerDocument.createElement('pre');title.textContent='保持中の予定下書き：'+draft.target.title+' / '+draft.target.start;notice.textContent='予定の変更前・別画面の復旧コピーです。現在の生徒の記録へ自動移管・再送しません。'+(draft.operationId?' 操作ID: '+draft.operationId:'');body.textContent=draft.value;details.append(title,notice,body);
      const download=host.ownerDocument.createElement('button');download.type='button';download.textContent='復旧コピーをファイルへ保存';download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)+'\n'],{type:'application/json'})),a=host.ownerDocument.createElement('a');a.href=url;a.download='works-plan-recovery-'+draft.context.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};details.append(download);
      if(draft.operationId){const audit=host.ownerDocument.createElement('a');audit.textContent='操作IDで保存結果を確認';audit.href='/tutor/history.html?'+new URLSearchParams({operation_id:draft.operationId});details.append(audit);}panel.append(details);
    }
    panel.hidden=!panel.childElementCount;
  }
}


export function renderMemoEditors(root, studentMemos, { isProfileDisabled = () => false, resizeRecordInput }) {
  const messages = { idle: "", loading: "読み込み中…", ready: "日付をまたいで共有・変更後に自動保存", unsaved: "未保存・入力を終えると自動保存", saving: "保存中…", saved: "保存済み", "load-error": "取得できませんでした", "save-error": "保存できませんでした・入力は保持しています" };
  root.querySelectorAll(".student-memo-editor").forEach((editor) => {
    const name = editor.dataset.studentName;
    const input = editor.querySelector(".student-memo-input");
    const status = editor.querySelector(".student-memo-status");
    const retry = editor.querySelector(".student-memo-retry");
    if (!name) {
      input.value = "";
      input.disabled = true;
      status.textContent = "生徒を選択してください";
      retry.hidden = true;
      return;
    }
    const state = studentMemos.get(name);
    if (input.value !== state.value) input.value = state.value;
    input.disabled = !state.loaded || isProfileDisabled(input, name);
    status.textContent = messages[state.status];
    status.dataset.error = String(state.status.endsWith("error"));
    retry.hidden = !state.status.endsWith("error");
    editor.dataset.status = state.status;
    resizeRecordInput(input);
  });
}
