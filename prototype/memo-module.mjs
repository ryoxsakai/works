import {parseMemoAction} from './memo-model.mjs';
// Source-derived adapter of memo/app.js; no global handlers or duplicate authentication.
import view from './memo-view.html?raw';import './memo-native.css';
export function mountMemo(root,context,{id:routeId,navigate}){
let alive=true,loaded=false,editorSaving=false,editorBase='',switching=false,previousOverflow;const lifecycle=new AbortController(),timers=new Set(),remembered=context.memoState ||= {tag:null,edit:null};
root.classList.add('memo-native');root.innerHTML='<p><a class="external" href="/memo/">従来のメモ画面へ ↗</a></p>'+view;
const $=id=>root.querySelector('#'+CSS.escape(id)),page=root.closest('.page-content');
function editorSnapshot(){return JSON.stringify({fields:[...$('memo-modal').querySelectorAll('input,select,textarea')].map(el=>[el.id,el.value]),tags:modalTags});}
function editorDirty(){return $('memo-modal').open&&editorSnapshot()!==editorBase;}
function categoryDirty(){return $('category-modal').open&&(!!$('new-category-input').value.trim()||editingCatIdx>=0);}
function showDialog(dialog){if(dialog.open)return;if(!root.querySelector('dialog[open]')&&page){previousOverflow=page.style.overflow;page.style.overflow='hidden';}dialog.showModal();}
function hideDialog(dialog){dialog.close();if(!root.querySelector('dialog[open]')&&page)page.style.overflow=previousOverflow||'';}
function leaveList(){if(!pendingSaves)navigate('/memo/');}
function status(text){if(!alive)return;$('save-status').textContent=text;for(const d of root.querySelectorAll('dialog'))d.querySelector('[data-memo-status]').textContent=text;}
function controls(){if(!alive)return;for(const el of root.querySelectorAll('button,input,select,textarea')){if(el.dataset.memoSafe!==undefined||/^(closeMemoModal|closeCategoryModal|closeViewModal|copyMemo|viewCopyMemo)\(/.test(el.dataset.memoAction||''))el.disabled=editorSaving;else{el.disabled=!loaded||saveFailed||(editorSaving&&!!el.closest('#memo-modal'))||el.hasAttribute('data-fixed-disabled');}}$('export-draft').hidden=!(saveFailed||validationFailed);for(const box of root.querySelectorAll('[data-recovery]'))box.hidden=!saveFailed;}
const categoryUI={open(){showDialog($('category-modal'));$('new-category-input').focus();},close(){if(categoryDirty()&&!confirm('未保存のカテゴリ入力を破棄しますか？'))return false;hideDialog($('category-modal'));return true;},focus(i,action='startEditCat',direction){const args=direction===undefined?i:`${i},${direction}`;const button=root.querySelector(`#category-modal [data-memo-action="${action}(${args})"]`);(button&&!button.disabled?button:root.querySelector(`#category-modal [data-memo-action="startEditCat(${i})"]`))?.focus();}};
    // ─── State ───────────────────────────────────────────────
    let memos      = [];
    let categories = ['日常', '仕事', 'アイデア'];
    let activeTab  = 'すべて';
    let activeTag  = null;
    let modalTags   = [];
    let modalNotes  = [];
    let modalBodies = [''];
    let editingMemoId = null;
    let editingCatIdx = -1;
    let viewingMemoId = null;

    const TAB_KEY = 'works-memo-active-tab';
    let revision = 0;
    let savedState;
    let saveQueue = Promise.resolve();
    let pendingSaves = 0;
    let saveFailed = false, validationFailed=false;
    async function api(method,data){if(!alive)throw new DOMException('Memo closed','AbortError');const value=await context.request('/api/memo',{method,body:data,signal:lifecycle.signal});if(!alive)throw new DOMException('Memo closed','AbortError');return value;}
    async function loadData(){const value=await api('GET');if(!Array.isArray(value?.memos)||!Array.isArray(value.categories)||!Number.isSafeInteger(value.revision))throw Error('メモの応答を確認できません');savedState=structuredClone(value);({memos,categories,revision}=value);try{activeTab=localStorage.getItem(TAB_KEY)||'すべて';}catch{}if(!categories.includes(activeTab))activeTab='すべて';activeTag=remembered.tag;loaded=true;render();controls();}
    function saveData(){const snapshot=structuredClone({memos,categories});pendingSaves++;status('保存中…');controls();const run=saveQueue.then(async()=>{if(!alive||saveFailed)return false;try{const expected=revision,result=await api('PUT',{...snapshot,revision:expected});if(result?.revision!==expected+1||JSON.stringify(result.memos)!==JSON.stringify(snapshot.memos)||JSON.stringify(result.categories)!==JSON.stringify(snapshot.categories))throw Error('保存応答を確認できません');savedState=structuredClone(result);revision=result.revision;validationFailed=false;return true;}catch(e){if(!alive)return false;if([400,413].includes(e.status)){validationFailed=true;status('入力の形式・長さ・容量を確認してください。内容は保持しています。修正後に保存できます。');return false;}saveFailed=true;status(e.status===409?'別の画面の更新と競合しました。入力を保持し保存を停止しました。':'保存結果を確認できません。入力を保持し自動再送を停止しました。');return false;}}).finally(()=>{pendingSaves--;if(!alive)return;if(!saveFailed&&!validationFailed&&!pendingSaves&&JSON.stringify({memos,categories})===JSON.stringify({memos:savedState.memos,categories:savedState.categories}))status('保存済み');controls();});saveQueue=run.then(()=>{});return run;}
    function exportDraft(){const fields=[...root.querySelectorAll('input,textarea,select')].map(el=>[el.id,el.value]);const url=URL.createObjectURL(new Blob([JSON.stringify({revision,savedState,input:{memos,categories,fields,modalTags,modalBodies,modalNotes},pendingSaves,saveFailed},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='works-memo-unsaved.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    // ─── Date helpers ─────────────────────────────────────────
    function todayStr() { return new Date().toISOString().split('T')[0]; }

    function formatDate(str) {
      if (!str) return '';
      const d = new Date(str + 'T00:00:00');
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())}`;
    }

    // ─── Memo modal ───────────────────────────────────────────
    function openMemoModal(id) {
      if(id&&id!==routeId){remembered.edit=id;navigate('/memo/'+encodeURIComponent(id)+'/');return;}
      editingMemoId = id;
      const inputTitle = $('modal-title');
      const datesEl    = $('modal-dates');

      renderModalCategorySelect();

      if (id) {
        const memo = memos.find(m => m.id === id);
        if (!memo) return;
        $('memo-modal-title').textContent = 'メモを編集';
        inputTitle.value = memo.title;
        $('modal-category').value = memo.category;
        modalBodies = memo.bodies && memo.bodies.length ? [...memo.bodies] : (memo.body !== undefined ? [memo.body] : ['']);
        if (!modalBodies.length) modalBodies = [''];
        modalNotes = memo.notes ? [...memo.notes] : (memo.note ? [memo.note] : []);
        modalTags = [...(memo.tags || [])];
        datesEl.classList.remove('hidden');
        $('modal-created-at').textContent = formatDate(memo.createdAt);
        $('modal-updated-at').textContent = formatDate(memo.updatedAt || memo.createdAt);
      } else {
        $('memo-modal-title').textContent = '新規メモ';
        inputTitle.value = '';
        if (activeTab !== 'すべて') {
          $('modal-category').value = activeTab;
        }
        modalBodies = [''];
        modalNotes = [];
        modalTags = [];
        datesEl.classList.add('hidden');
      }
      renderModalBodies();
      renderModalNotes();
      renderModalTags();

      showDialog($('memo-modal'));editorBase=editorSnapshot();inputTitle.focus();
    }

    function closeMemoModal(force=false){if(editorSaving||(!force&&editorDirty()&&!confirm('未保存の入力を破棄しますか？')))return false;hideDialog($('memo-modal'));editingMemoId=null;modalTags=[];modalNotes=[];modalBodies=[''];if(routeId&&!$('view-modal').open&&!$('category-modal').open)leaveList();return true;}
    function renderModalBodies() {
      const container = $('bodies-container');
      if (!container) return;
      const multi = modalBodies.length > 1;
      container.innerHTML = modalBodies.map((body, i) => {
        const isFirst = i === 0;
        const isLast  = i === modalBodies.length - 1;
        return `${i > 0 ? '<div style="border-top:1px dashed #e5e7eb"></div>' : ''}
        <div class="flex flex-col gap-1.5 ${i > 0 ? 'pt-1' : ''}">
          <div class="flex items-center justify-between min-h-5">
            <label for="modal-body-${i}" class="text-xs font-medium text-gray-500">${multi ? `本文${i + 1}` : '本文'}</label>
            ${multi ? `<div class="flex items-center gap-0.5">
              <button type="button" data-memo-action="moveModalBody(${i},-1)" ${isFirst?'disabled data-fixed-disabled':''} aria-label="本文${i+1}を上へ"
                class="icon-btn w-5 h-5 text-gray-300 hover:text-gray-500 ${isFirst ? 'opacity-20 pointer-events-none' : ''}">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
              </button>
              <button type="button" data-memo-action="moveModalBody(${i},1)" ${isLast?'disabled data-fixed-disabled':''} aria-label="本文${i+1}を下へ"
                class="icon-btn w-5 h-5 text-gray-300 hover:text-gray-500 ${isLast ? 'opacity-20 pointer-events-none' : ''}">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              <button type="button" data-memo-action="removeModalBody(${i})" aria-label="本文${i+1}を削除"
                class="text-xs text-gray-300 hover:text-gray-500 transition-colors ml-1">✕</button>
            </div>` : ''}
          </div>
          <textarea id="modal-body-${i}" placeholder="メモの内容を入力..."
            class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent placeholder-gray-300 resize-none"
            style="min-height:${multi ? '100px' : '200px'}">${esc(body)}</textarea>
        </div>`;
      }).join('');
    }

    function syncModalBodies() {
      const inputs = root.querySelectorAll('[id^="modal-body-"]');
      modalBodies = Array.from(inputs).map(inp => inp.value);
    }

    function addModalBody() {
      syncModalBodies();
      if(modalBodies.length>=100){status('本文は100欄までです');return;}modalBodies.push('');
      renderModalBodies();
      const last = $(`modal-body-${modalBodies.length - 1}`);
      if (last) last.focus();
    }

    function removeModalBody(i) {
      if (modalBodies.length <= 1) return;
      syncModalBodies();
      modalBodies.splice(i, 1);
      renderModalBodies();$('modal-body-'+Math.min(i,modalBodies.length-1))?.focus();
    }

    function moveModalBody(i, dir) {
      syncModalBodies();
      const j = i + dir;
      if (j < 0 || j >= modalBodies.length) return;
      [modalBodies[i], modalBodies[j]] = [modalBodies[j], modalBodies[i]];
      renderModalBodies();$('modal-body-'+j)?.focus();
    }

    function renderModalNotes() {
      const container = $('notes-container');
      if (!container) return;
      container.innerHTML = modalNotes.map((note, i) =>
        `<div class="flex items-center gap-2">
          <span class="text-xs text-gray-400 whitespace-nowrap w-10 flex-shrink-0">補足${i + 1}</span>
          <input type="text" id="modal-note-${i}" aria-label="補足${i+1}" value="${esc(note)}" placeholder="URLや一言メモを入力..."
            class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent placeholder-gray-300"/>
          <button type="button" data-memo-action="removeModalNote(${i})" aria-label="補足${i+1}を削除"
            class="flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>`
      ).join('');
    }

    function syncModalNotes() {
      const noteInputs = root.querySelectorAll('[id^="modal-note-"]');
      modalNotes = Array.from(noteInputs).map(inp => inp.value);
    }

    function addModalNote() {
      syncModalNotes();
      if(modalNotes.length>=100){status('補足は100欄までです');return;}modalNotes.push('');
      renderModalNotes();
      const last = $(`modal-note-${modalNotes.length - 1}`);
      if (last) last.focus();
    }

    function removeModalNote(i) {
      syncModalNotes();
      modalNotes.splice(i, 1);
      renderModalNotes();$('modal-note-'+Math.min(i,modalNotes.length-1))?.focus();
    }

    async function saveMemo() {
      if(editorSaving||saveFailed||!loaded)return;
      const title    = $('modal-title').value.trim();
      const category = $('modal-category').value;
      const bodyInputs = root.querySelectorAll('[id^="modal-body-"]');
      const bodies   = Array.from(bodyInputs).map(inp => inp.value);
      const noteInputs = root.querySelectorAll('[id^="modal-note-"]');
      const notes    = Array.from(noteInputs).map(inp => inp.value.trim()).filter(Boolean);

      if (!title || title.length > 500) {
        const inp = $('modal-title');
        inp.classList.add('ring-2', 'ring-red-400');
        inp.focus();
        setTimeout(() => inp.classList.remove('ring-2', 'ring-red-400'), 1500);
        return;
      }

      if (editingMemoId) {
        const memo = memos.find(m => m.id === editingMemoId);
        if (memo) {
          memo.title     = title;
          memo.category  = category;
          memo.bodies    = bodies;
          memo.notes     = notes;
          memo.tags      = [...modalTags];
          memo.updatedAt = todayStr();
        }
      } else {
        editingMemoId=crypto.randomUUID();memos.push({ id: editingMemoId, title, category, tags: [...modalTags], bodies, notes, createdAt: todayStr(), updatedAt: todayStr() });
      }

      editorSaving=true;controls();const ok=await saveData();editorSaving=false;if(!alive)return;controls();if(ok){render();closeMemoModal(true);}
    }

    // ─── Delete ───────────────────────────────────────────────
    function deleteMemo(id) {
      const memo = memos.find(m => m.id === id);
      if (!memo || !confirm(`「${memo.title}」を削除しますか？`)) return;
      memos = memos.filter(m => m.id !== id);
      saveData();
      renderTagFilter(); renderMemoGrid();
    }

    // ─── Reorder ─────────────────────────────────────────────
    function moveMemo(id, dir) {
      const filtered = getFilteredMemos();
      const idx = filtered.findIndex(m => m.id === id);
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= filtered.length) return;
      const ai = memos.indexOf(filtered[idx]);
      const bi = memos.indexOf(filtered[targetIdx]);
      [memos[ai], memos[bi]] = [memos[bi], memos[ai]];
      saveData();
      renderTagFilter(); renderMemoGrid();
    }

    // ─── Tabs ─────────────────────────────────────────────────
    function setTab(tab) { activeTab = tab; activeTag = null;remembered.tag=null; try { localStorage.setItem(TAB_KEY, tab); } catch {} renderTabs(); renderTagFilter(); renderMemoGrid(); }

    function renderTabs() {
      const container = $('tab-list');
      const tabs = ['すべて', ...categories];
      if (!tabs.includes(activeTab)) activeTab = 'すべて';
      container.innerHTML = tabs.map(t => {
        const active = t === activeTab;
        return `<button data-memo-action="setTab(${jsArg(t)})"
          class="tab-btn px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap
            ${active ? 'border-slate-700 text-slate-700 bg-slate-50' : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'}">
          ${esc(t)}
        </button>`;
      }).join('');
    }

    // ─── Category modal ────────────────────────────────────────
    function openCategoryModal() {
      editingCatIdx = -1;
      $('new-category-input').value = '';
      renderCategoryList();
      categoryUI.open();
    }

    function closeCategoryModal() {
      if(categoryUI.close())editingCatIdx = -1;
    }

    function renderCategoryList() {
      const ul = $('category-list');
      if (!categories.length) {
        ul.innerHTML = '<li class="text-center text-gray-400 text-sm py-4">カテゴリがありません。下の入力欄から追加してください。</li>';
        return;
      }
      ul.innerHTML = categories.map((cat, i) => {
        const count = memos.filter(m => m.category === cat).length;
        if (i === editingCatIdx) {
          return `<li class="flex items-center gap-2 rounded-xl px-3 py-2 bg-slate-50">
  <input id="edit-cat-input" aria-label="カテゴリ名を変更" type="text" value="${esc(cat)}"
    class="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"/>
  <button type="button" aria-label="変更を保存" title="変更を保存" data-memo-action="saveEditCat(${i})" class="icon-btn text-slate-600 hover:bg-slate-100">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
  </button>
  <button type="button" aria-label="変更をキャンセル" title="変更をキャンセル" data-memo-action="cancelEditCat()" class="icon-btn text-gray-400 hover:bg-gray-100">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
  </button>
</li>`;
        }
        return `<li class="category-row flex items-center gap-1 rounded-xl px-3 py-2 hover:bg-gray-50 group">
  <div class="category-order flex mr-1">
    <button type="button" aria-label="上へ移動" title="上へ移動" data-memo-action="moveCat(${i},-1)" ${i===0?'disabled data-fixed-disabled':''} class="icon-btn w-5 h-4 text-gray-300 hover:text-gray-500 ${i===0?'opacity-20 pointer-events-none':''}">
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
    </button>
    <button type="button" aria-label="下へ移動" title="下へ移動" data-memo-action="moveCat(${i},1)" ${i===categories.length-1?'disabled data-fixed-disabled':''} class="icon-btn w-5 h-4 text-gray-300 hover:text-gray-500 ${i===categories.length-1?'opacity-20 pointer-events-none':''}">
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
    </button>
  </div>
  <div class="category-summary"><span class="category-name flex-1 text-sm text-gray-700">${esc(cat)}</span>
  ${count > 0 ? `<span class="category-count text-xs text-gray-400">${count}件</span>` : ''}</div>
  <button type="button" aria-label="名前を変更" title="名前を変更" data-memo-action="startEditCat(${i})" class="icon-btn text-gray-300 hover:text-slate-500 hover:bg-slate-50">
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
  </button>
  <button type="button" aria-label="削除" title="削除" data-memo-action="deleteCat(${i})" class="icon-btn text-gray-300 hover:text-red-400 hover:bg-red-50">
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
  </button>
</li>`;
      }).join('');
      if (editingCatIdx >= 0) {
        {const el=$('edit-cat-input');if(el){el.focus();el.select();}}
      }
    }

    function startEditCat(i) { editingCatIdx = i; renderCategoryList(); }
    function cancelEditCat() { const index = editingCatIdx; editingCatIdx = -1; renderCategoryList(); categoryUI.focus(index); }

    function saveEditCat(i) {
      const inp  = $('edit-cat-input');
      const name = inp ? inp.value.trim() : '';
      if (!name || name === "すべて" || name.length > 100) { alert("カテゴリ名は100文字以内で入力してください。「すべて」は使用できません。"); if (inp) inp.focus(); return; }
      if (name === categories[i]) { cancelEditCat(); return; }
      if (categories.includes(name)) { alert(`「${name}」はすでに存在します`); inp.focus(); return; }
      const old = categories[i],selected=$('modal-category').value;
      categories[i] = name;
      memos.forEach(m => { if (m.category === old) m.category = name; });
      saveData(); editingCatIdx = -1;
      renderCategoryList(); renderModalCategorySelect();if(selected===old)$('modal-category').value=name; renderTabs(); renderTagFilter(); renderMemoGrid();
      categoryUI.focus(i);
    }

    function deleteCat(i) {
      const name  = categories[i];
      const count = memos.filter(m => m.category === name).length;
      const msg   = count > 0
        ? `「${name}」は${count}件のメモで使用中です。\n移動先：「${categories.find((_,idx)=>idx!==i)||'カテゴリなし'}」。削除しますか？`
        : `「${name}」を削除しますか？`;
      if (!confirm(msg)) return;
      if (count > 0) {
        const fallback = categories.find((_, idx) => idx !== i) || '';
        memos.forEach(m => { if (m.category === name) m.category = fallback; });
      }
      categories.splice(i, 1);
      editingCatIdx = -1;
      if (activeTab === name) activeTab = 'すべて';
      saveData();
      renderCategoryList(); renderModalCategorySelect(); renderTabs(); renderTagFilter(); renderMemoGrid();
      if (categories.length) categoryUI.focus(Math.min(i, categories.length - 1));
      else $('new-category-input').focus();
    }

    function moveCat(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= categories.length) return;
      [categories[i], categories[j]] = [categories[j], categories[i]];
      saveData(); renderCategoryList(); renderModalCategorySelect(); renderTabs();
      categoryUI.focus(j, 'moveCat', dir);
    }

    function addCategory() {
      const inp  = $('new-category-input');
      const name = inp.value.trim();
      if (!name || name === "すべて" || name.length > 100) { alert("カテゴリ名は100文字以内で入力してください。「すべて」は使用できません。"); inp.focus(); return; }
      if (categories.includes(name)) { alert(`「${name}」はすでに存在します`); inp.focus(); return; }
      if(categories.length>=200){status('カテゴリは200件までです');return;}categories.push(name);
      saveData();
      renderCategoryList(); renderModalCategorySelect(); renderTabs();
      inp.value = ''; inp.focus();
    }

    // ─── Modal category select ────────────────────────────────
    function renderModalCategorySelect() {
      const sel  = $('modal-category');
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      if (categories.includes(prev)) sel.value = prev;
    }

    // ─── Tag filter ──────────────────────────────────────────
    function renderTagFilter() {
      const container = $('tag-filter');
      const base = activeTab === 'すべて' ? memos : memos.filter(m => m.category === activeTab);
      const allTags = [...new Set(base.flatMap(m => m.tags || []))].sort();
      if (!allTags.includes(activeTag)) activeTag = null;
      if (!allTags.length) {
        container.classList.add('hidden');
        if (!allTags.includes(activeTag)) activeTag = null;
        return;
      }
      container.classList.remove('hidden');
      container.innerHTML = allTags.map(tag => {
        const on = tag === activeTag;
        return `<button data-memo-action="setTagFilter(${jsArg(tag)})"
          class="px-2.5 py-1 rounded-full text-xs border transition-colors whitespace-nowrap
            ${on ? 'bg-slate-700 text-white border-slate-700' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}">
          #${esc(tag)}
        </button>`;
      }).join('');
    }

    function setTagFilter(tag) {
      activeTag = activeTag === tag ? null : tag;remembered.tag=activeTag;
      renderTagFilter(); renderMemoGrid();
    }

    // ─── Modal tags ───────────────────────────────────────────
    function renderModalTags() {
      const list = $('modal-tags-list');
      if (!list) return;
      list.innerHTML = modalTags.map((tag, i) =>
        `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-600 border border-slate-200">
          #${esc(tag)}
          <button type="button" data-memo-action="removeModalTag(${i})" aria-label="タグ${esc(tag)}を削除"
            class="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">✕</button>
        </span>`
      ).join('');
    }

    function handleTagInput(e) {
      if (e.key !== 'Enter'||e.isComposing||e.keyCode===229) return;
      e.preventDefault();
      const inp = e.target;
      const val = inp.value.trim().replace(/[,#]/g, '');
      if (val.length > 100 || modalTags.length >= 100) { alert('タグは100文字以内、100個までです'); return; }
      if (!val || modalTags.includes(val)) { inp.value = ''; return; }
      modalTags.push(val);
      renderModalTags();
      inp.value = '';
    }

    function removeModalTag(i) {
      modalTags.splice(i, 1);
      renderModalTags();
    }

    // ─── Memo grid ────────────────────────────────────────────
    function getFilteredMemos() {
      let result = activeTab === 'すべて' ? memos : memos.filter(m => m.category === activeTab);
      if (activeTag) result = result.filter(m => (m.tags || []).includes(activeTag));
      return result;
    }

    function renderMemoGrid() {
      const grid  = $('memo-grid');
      const empty = $('empty-state');
      const filtered = getFilteredMemos();

      if (!filtered.length) {
        grid.innerHTML = ''; empty.classList.remove('hidden'); return;
      }
      empty.classList.add('hidden');

      grid.innerHTML = filtered.map((memo, idx) => {
        const isFirst = idx === 0;
        const isLast  = idx === filtered.length - 1;
        const firstBody = (memo.bodies && memo.bodies[0]) || memo.body || '';
        const preview = firstBody
          ? esc(firstBody).replace(/\n/g, '<br>')
          : '<span class="text-gray-300 italic">内容なし</span>';

        return `<div class="memo-card relative bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col cursor-pointer" style="min-height:150px" data-memo-action="openMemoView(${jsArg(memo.id)}, event)">
  <span class="absolute top-3 right-3 px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-500 border border-slate-100 max-w-28 truncate">${esc(memo.category)}</span>
  <div class="px-4 pt-4 pb-2 pr-28">
    <p class="font-semibold text-gray-800 text-sm leading-snug"><a class="memo-open-title" href="/memo/${encodeURIComponent(memo.id)}/">${esc(memo.title)}</a></p>
  </div>
  <div class="px-4 pb-2 flex-1">
    <p class="text-xs text-gray-500 leading-relaxed" style="display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">${preview}</p>
  </div>
  ${(memo.tags && memo.tags.length) ? `<div class="px-4 pb-2 flex flex-wrap gap-1">${memo.tags.map(t => `<span class="px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-500 border border-slate-200">#${esc(t)}</span>`).join('')}</div>` : ''}
  <div class="px-3 pb-1.5 flex items-center justify-between border-t border-gray-50 pt-1">
    <div class="flex gap-0.5">
      <button data-memo-action="moveMemo(${jsArg(memo.id)},-1)" ${isFirst ? 'disabled data-fixed-disabled' : ''} title="上へ"
        class="icon-btn w-6 h-6 text-gray-300 hover:text-gray-500 hover:bg-gray-100 ${isFirst ? 'opacity-20 pointer-events-none' : ''}">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
      </button>
      <button data-memo-action="moveMemo(${jsArg(memo.id)},1)" ${isLast ? 'disabled data-fixed-disabled' : ''} title="下へ"
        class="icon-btn w-6 h-6 text-gray-300 hover:text-gray-500 hover:bg-gray-100 ${isLast ? 'opacity-20 pointer-events-none' : ''}">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
      </button>
    </div>
    <div class="flex gap-0.5">
      <button data-memo-action="copyMemo(${jsArg(memo.id)}, null)" title="コピー"
        class="icon-btn text-gray-300 hover:text-slate-500 hover:bg-slate-50">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
      </button>
      <button data-memo-action="openMemoModal(${jsArg(memo.id)})" title="編集"
        class="icon-btn text-gray-300 hover:text-slate-500 hover:bg-slate-50">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
      </button>
      <button data-memo-action="deleteMemo(${jsArg(memo.id)})" title="削除"
        class="icon-btn text-gray-300 hover:text-red-400 hover:bg-red-50">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    </div>
  </div>
</div>`;
      }).join('');
    }

    function render() { renderTabs(); renderTagFilter(); renderMemoGrid(); renderModalCategorySelect(); }

    // ─── Toast ────────────────────────────────────────────────
    let toastTimer = null;
    function showToast(msg) {
      if(!alive)return;
      const toast = $('toast');
      toast.textContent = msg;
      toast.style.transform = 'translateX(-50%) translateY(0)';
      toast.style.opacity = '1';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(-120%)';
        toast.style.opacity = '0';
      }, 2000);
    }

    function openMemoView(id, e) {
      if(id!==routeId){navigate('/memo/'+encodeURIComponent(id)+'/');return;}
      if (e?.target.closest("button")) return;
      if (e && e.target.closest('button')) return;
      const memo = memos.find(m => m.id === id);
      if (!memo) return;
      viewingMemoId = id;
      $('view-title').textContent = memo.title;
      $('view-category').textContent = memo.category;
      const viewBodies = memo.bodies && memo.bodies.length ? memo.bodies : (memo.body !== undefined ? [memo.body] : []);
      const viewBodyContainer = $('view-body-container');
      const nonEmptyBodies = viewBodies.filter(b => b && b.trim());
      viewBodyContainer.innerHTML = nonEmptyBodies.map((b, i) =>
        `${i > 0 ? '<div style="border-top:1.5px dashed #d1d5db;margin:12px 0"></div>' : ''}
         <p class="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap select-text">${linkifyText(b)}</p>`
      ).join('');
      const notesWrap = $('view-notes-wrap');
      const notes = memo.notes || (memo.note ? [memo.note] : []);
      if (notes.length) {
        notesWrap.classList.remove('hidden');
        notesWrap.innerHTML = notes.map(n =>
          `<p class="text-xs text-gray-400 leading-relaxed select-text break-all">${linkifyText(n)}</p>`
        ).join('');
      } else {
        notesWrap.classList.add('hidden');
      }
      const tagsEl = $('view-tags');
      if (memo.tags && memo.tags.length) {
        tagsEl.classList.remove('hidden');
        tagsEl.innerHTML = memo.tags.map(t => `<span class="px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-500 border border-slate-200">#${esc(t)}</span>`).join('');
      } else {
        tagsEl.classList.add('hidden');
      }
      const parts = [];
      if (memo.createdAt) parts.push(`作成: ${formatDate(memo.createdAt)}`);
      if (memo.updatedAt && memo.updatedAt !== memo.createdAt) parts.push(`更新: ${formatDate(memo.updatedAt)}`);
      $('view-dates').textContent = parts.join('　');
      showDialog($('view-modal'));$('view-modal').querySelector('[data-memo-action="closeViewModal()"]').focus();
    }

    function closeViewModal() {
      if(pendingSaves)return;hideDialog($('view-modal'));viewingMemoId=null;if(routeId&&!switching)leaveList();
    }

    function viewEditMemo() {
      if(pendingSaves)return;
      const id = viewingMemoId;
      switching=true;closeViewModal();switching=false;openMemoModal(id);
    }

    async function viewDeleteMemo(){const memo=memos.find(m=>m.id===viewingMemoId);if(!memo||!confirm(`「${memo.title}」を削除しますか？`))return;memos=memos.filter(m=>m.id!==memo.id);const ok=await saveData();if(!alive)return;renderTagFilter();renderMemoGrid();if(ok)closeViewModal();}
    async function viewCopyMemo() {
      const memo = memos.find(m => m.id === viewingMemoId);
      if (!memo) return;
      try {
        const copyText = memo.bodies ? memo.bodies.join('\n\n') : (memo.body || '');
        await navigator.clipboard.writeText(copyText);
        showToast(`「${memo.title}」をコピーしました`);
      } catch(err) {
        console.error('コピーに失敗しました', err);
      }
    }

    async function copyMemo(id, e) {
      if (e && e.target.closest('button')) return;
      const memo = memos.find(m => m.id === id);
      if (!memo) return;
      try {
        const copyText = memo.bodies ? memo.bodies.join('\n\n') : (memo.body || '');
        await navigator.clipboard.writeText(copyText);
        showToast(`「${memo.title}」をコピーしました`);
      } catch(err) {
        console.error('コピーに失敗しました', err);
      }
    }

    function jsArg(value) { return esc(JSON.stringify(value)); }
    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function linkifyText(text) {
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const parts = [];
      let lastIndex = 0;
      let match;
      while ((match = urlRegex.exec(text)) !== null) {
        parts.push(esc(text.slice(lastIndex, match.index)));
        const url = match[1];
        parts.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 underline break-all">${esc(url)}</a>`);
        lastIndex = match.index + match[0].length;
      }
      parts.push(esc(text.slice(lastIndex)));
      return parts.join('');
    }


for(const dialog of root.querySelectorAll('dialog')){const recovery=document.createElement('div');recovery.innerHTML='<p data-memo-status role="status" aria-live="polite"></p><div data-recovery hidden><button data-memo-safe data-inspect>最新の保存内容を確認</button><button data-memo-safe data-reset>入力を破棄して最新を開く</button><button data-memo-safe data-export>未保存JSONを保存</button><pre hidden></pre></div>';dialog.prepend(recovery);dialog.addEventListener('cancel',event=>{event.preventDefault();if(editorSaving)return;if(dialog===$('memo-modal'))closeMemoModal();else if(dialog===$('category-modal'))closeCategoryModal();else closeViewModal();},{signal:lifecycle.signal});}
const mainRecovery=document.createElement('div');mainRecovery.dataset.recovery='';mainRecovery.hidden=true;mainRecovery.innerHTML='<button data-memo-safe data-inspect>最新の保存内容を確認</button><button data-memo-safe data-reset>入力を破棄して最新を開く</button><pre hidden></pre>';$('save-status').after(mainRecovery);$('export-draft').dataset.memoSafe='';
async function inspect(box){if(pendingSaves)return;try{const latest=await api('GET');box.querySelector('pre').hidden=false;box.querySelector('pre').textContent=JSON.stringify(latest,null,2);}catch(e){status('最新の保存内容を取得できませんでした。入力は保持しています。');}}
async function reset(){if(pendingSaves||!confirm('未保存の入力を破棄し、最新の保存内容を開きますか？'))return;try{await loadData();saveFailed=false;validationFailed=false;editingCatIdx=-1;modalTags=[];modalBodies=[''];modalNotes=[];for(const d of root.querySelectorAll('dialog[open]'))hideDialog(d);controls();status('最新の保存内容を開きました。自動再送はしていません。');if(routeId){if(memos.some(m=>m.id===routeId))openMemoView(routeId);else leaveList();}}catch(e){status('最新の保存内容を取得できませんでした。入力は保持しています。');}}
const actions={exportDraft,setTab,openCategoryModal,closeCategoryModal,addCategory,startEditCat,cancelEditCat,saveEditCat,deleteCat,moveCat,openMemoModal,closeMemoModal,saveMemo,addModalBody,removeModalBody,moveModalBody,addModalNote,removeModalNote,deleteMemo,moveMemo,copyMemo,openMemoView,closeViewModal,viewEditMemo,viewDeleteMemo,viewCopyMemo,setTagFilter,removeModalTag};
const reading=new Set(['exportDraft','closeMemoModal','closeCategoryModal','closeViewModal','copyMemo','viewCopyMemo']);
root.addEventListener('click',event=>{const safe=event.target.closest('[data-inspect],[data-reset],[data-export]');if(safe){if(safe.hasAttribute('data-inspect'))inspect(safe.closest('[data-recovery]'));else if(safe.hasAttribute('data-reset'))reset();else exportDraft();return;}const node=event.target.closest('[data-memo-action]');if(!node)return;const parsed=parseMemoAction(node.dataset.memoAction,new Set(Object.keys(actions)));if(!parsed)return;const {name,args}=parsed;event.preventDefault();if((!loaded||saveFailed||editorSaving)&&!reading.has(name))return;if(name==='openMemoView')args.push(event);actions[name](...args);},{signal:lifecycle.signal});
root.addEventListener('keydown',event=>{if(event.target===$('modal-tag-input'))handleTagInput(event);if(event.isComposing||event.keyCode===229)return;if(event.target===$('new-category-input')&&event.key==='Enter'){event.preventDefault();if(!saveFailed)addCategory();}if(event.target.id==='edit-cat-input'){if(event.key==='Enter'){event.preventDefault();if(!saveFailed)saveEditCat(editingCatIdx);}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelEditCat();}}},{signal:lifecycle.signal});
for(const d of root.querySelectorAll('dialog')){const heading=d.querySelector('h3');if(heading)d.setAttribute('aria-labelledby',heading.id);}
// Replace inline boundary styling with native disabled semantics after each render.
const observer=new MutationObserver(()=>{for(const b of root.querySelectorAll('button[disabled]')){if(!b.disabled)continue;if(b.classList.contains('pointer-events-none'))b.dataset.fixedDisabled='';}controls();});observer.observe(root,{childList:true,subtree:true});
async function initial(){controls();status('読み込み中…');try{await loadData();if(!alive)return;status('');if(routeId){if(remembered.edit===routeId){remembered.edit=null;openMemoModal(routeId);}else openMemoView(routeId);if(!memos.some(m=>m.id===routeId))status('このメモは削除されたか、見つかりません。');}}catch(e){if(!alive)return;status('読み込みに失敗しました。');const b=document.createElement('button');b.textContent='再試行';b.dataset.memoSafe='';b.onclick=()=>{b.remove();initial();};$('save-status').append(b);}}
initial();
return {get dirty(){return pendingSaves>0||saveFailed||validationFailed||editorDirty()||categoryDirty();},canLeave(){return !pendingSaves&&!editorSaving&&(!(saveFailed||validationFailed||editorDirty()||categoryDirty())||confirm('未保存または保存結果未確認の内容を破棄して移動しますか？'));},unmount(){alive=false;lifecycle.abort();observer.disconnect();clearTimeout(toastTimer);for(const timer of timers)clearTimeout(timer);for(const d of root.querySelectorAll('dialog[open]'))d.close();if(page)page.style.overflow=previousOverflow||'';root.replaceChildren();memos=categories=[];savedState=null;context.metrics.unmounts++;}};
}
