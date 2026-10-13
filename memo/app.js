import { watchAuth, signIn, signOutUser as worksSignOut, getSessionToken } from '../shared/auth.js?v=12';
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
    let saveFailed = false;
    async function api(method, data) {
      const response = await fetch('/api/memo', { method,
        headers: { 'Authorization': `Bearer ${getSessionToken()}`, 'Content-Type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || `保存に失敗しました (${response.status})`), { status: response.status });
      return result;
    }
    async function loadData() {
      savedState = await api('GET');
      ({ memos, categories, revision } = savedState);
      try { activeTab = localStorage.getItem(TAB_KEY) || 'すべて'; } catch {}
      if (!categories.includes(activeTab)) activeTab = 'すべて';
      render();
    }
    function saveData() {
      const snapshot = structuredClone({ memos, categories });
      pendingSaves++;
      document.querySelector('#save-status').textContent = '保存中…';
      saveQueue = saveQueue.then(async () => {
        if (saveFailed) return;
        try {
          savedState = await api('PUT', { ...snapshot, revision });
          revision = savedState.revision;
        } catch (error) {
          saveFailed = ![400, 413].includes(error.status);
          document.querySelector('#save-status').textContent = error.message + '。未保存の内容をJSONで保存してから再読み込みしてください。';
          document.querySelector('#export-draft').hidden = false;
          alert(error.message + '。内容はこの画面に残っています。再読み込み前に未保存JSONを保存してください。');
        }
      }).finally(() => {
        pendingSaves--;
        if (!saveFailed && !pendingSaves && savedState && JSON.stringify({ memos, categories }) === JSON.stringify({ memos: savedState.memos, categories: savedState.categories })) { document.querySelector('#save-status').textContent = '保存済み'; document.querySelector('#export-draft').hidden = true; }
      });
    }
    function exportDraft() {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ memos, categories }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'works-memo-unsaved.json'; link.click(); URL.revokeObjectURL(url);
    }
    window.addEventListener('beforeunload', event => {
      if (pendingSaves || saveFailed || document.querySelector('#export-draft').hidden === false || !document.querySelector('#memo-modal').classList.contains('hidden')) {
        event.preventDefault(); event.returnValue = '';
      }
    });
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
      editingMemoId = id;
      const inputTitle = document.getElementById('modal-title');
      const datesEl    = document.getElementById('modal-dates');

      renderModalCategorySelect();

      if (id) {
        const memo = memos.find(m => m.id === id);
        if (!memo) return;
        document.getElementById('memo-modal-title').textContent = 'メモを編集';
        inputTitle.value = memo.title;
        document.getElementById('modal-category').value = memo.category;
        modalBodies = memo.bodies && memo.bodies.length ? [...memo.bodies] : (memo.body !== undefined ? [memo.body] : ['']);
        if (!modalBodies.length) modalBodies = [''];
        modalNotes = memo.notes ? [...memo.notes] : (memo.note ? [memo.note] : []);
        modalTags = [...(memo.tags || [])];
        datesEl.classList.remove('hidden');
        document.getElementById('modal-created-at').textContent = formatDate(memo.createdAt);
        document.getElementById('modal-updated-at').textContent = formatDate(memo.updatedAt || memo.createdAt);
      } else {
        document.getElementById('memo-modal-title').textContent = '新規メモ';
        inputTitle.value = '';
        if (activeTab !== 'すべて') {
          document.getElementById('modal-category').value = activeTab;
        }
        modalBodies = [''];
        modalNotes = [];
        modalTags = [];
        datesEl.classList.add('hidden');
      }
      renderModalBodies();
      renderModalNotes();
      renderModalTags();

      document.getElementById('memo-modal').classList.remove('hidden');
      setTimeout(() => inputTitle.focus(), 50);
    }

    function closeMemoModal() {
      document.getElementById('memo-modal').classList.add('hidden');
      editingMemoId = null;
      modalTags   = [];
      modalNotes  = [];
      modalBodies = [''];
    }

    function renderModalBodies() {
      const container = document.getElementById('bodies-container');
      if (!container) return;
      const multi = modalBodies.length > 1;
      container.innerHTML = modalBodies.map((body, i) => {
        const isFirst = i === 0;
        const isLast  = i === modalBodies.length - 1;
        return `${i > 0 ? '<div style="border-top:1px dashed #e5e7eb"></div>' : ''}
        <div class="flex flex-col gap-1.5 ${i > 0 ? 'pt-1' : ''}">
          <div class="flex items-center justify-between min-h-5">
            <label class="text-xs font-medium text-gray-500">${multi ? `本文${i + 1}` : '本文'}</label>
            ${multi ? `<div class="flex items-center gap-0.5">
              <button type="button" onclick="moveModalBody(${i},-1)"
                class="icon-btn w-5 h-5 text-gray-300 hover:text-gray-500 ${isFirst ? 'opacity-20 pointer-events-none' : ''}">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
              </button>
              <button type="button" onclick="moveModalBody(${i},1)"
                class="icon-btn w-5 h-5 text-gray-300 hover:text-gray-500 ${isLast ? 'opacity-20 pointer-events-none' : ''}">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              <button type="button" onclick="removeModalBody(${i})"
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
      const inputs = document.querySelectorAll('[id^="modal-body-"]');
      modalBodies = Array.from(inputs).map(inp => inp.value);
    }

    function addModalBody() {
      syncModalBodies();
      modalBodies.push('');
      renderModalBodies();
      const last = document.getElementById(`modal-body-${modalBodies.length - 1}`);
      if (last) last.focus();
    }

    function removeModalBody(i) {
      if (modalBodies.length <= 1) return;
      syncModalBodies();
      modalBodies.splice(i, 1);
      renderModalBodies();
    }

    function moveModalBody(i, dir) {
      syncModalBodies();
      const j = i + dir;
      if (j < 0 || j >= modalBodies.length) return;
      [modalBodies[i], modalBodies[j]] = [modalBodies[j], modalBodies[i]];
      renderModalBodies();
    }

    function renderModalNotes() {
      const container = document.getElementById('notes-container');
      if (!container) return;
      container.innerHTML = modalNotes.map((note, i) =>
        `<div class="flex items-center gap-2">
          <span class="text-xs text-gray-400 whitespace-nowrap w-10 flex-shrink-0">補足${i + 1}</span>
          <input type="text" id="modal-note-${i}" value="${esc(note)}" placeholder="URLや一言メモを入力..."
            class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent placeholder-gray-300"/>
          <button type="button" onclick="removeModalNote(${i})"
            class="flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>`
      ).join('');
    }

    function syncModalNotes() {
      const noteInputs = document.querySelectorAll('[id^="modal-note-"]');
      modalNotes = Array.from(noteInputs).map(inp => inp.value);
    }

    function addModalNote() {
      syncModalNotes();
      modalNotes.push('');
      renderModalNotes();
      const last = document.getElementById(`modal-note-${modalNotes.length - 1}`);
      if (last) last.focus();
    }

    function removeModalNote(i) {
      syncModalNotes();
      modalNotes.splice(i, 1);
      renderModalNotes();
    }

    function saveMemo() {
      const title    = document.getElementById('modal-title').value.trim();
      const category = document.getElementById('modal-category').value;
      const bodyInputs = document.querySelectorAll('[id^="modal-body-"]');
      const bodies   = Array.from(bodyInputs).map(inp => inp.value);
      const noteInputs = document.querySelectorAll('[id^="modal-note-"]');
      const notes    = Array.from(noteInputs).map(inp => inp.value.trim()).filter(Boolean);

      if (!title || title.length > 500) {
        const inp = document.getElementById('modal-title');
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
        memos.push({ id: crypto.randomUUID(), title, category, tags: [...modalTags], bodies, notes, createdAt: todayStr(), updatedAt: todayStr() });
      }

      saveData();
      closeMemoModal();
      render();
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
    function setTab(tab) { activeTab = tab; activeTag = null; try { localStorage.setItem(TAB_KEY, tab); } catch {} renderTabs(); renderTagFilter(); renderMemoGrid(); }

    function renderTabs() {
      const container = document.getElementById('tab-list');
      const tabs = ['すべて', ...categories];
      if (!tabs.includes(activeTab)) activeTab = 'すべて';
      container.innerHTML = tabs.map(t => {
        const active = t === activeTab;
        return `<button onclick="setTab(${jsArg(t)})"
          class="tab-btn px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap
            ${active ? 'border-slate-700 text-slate-700 bg-slate-50' : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'}">
          ${esc(t)}
        </button>`;
      }).join('');
    }

    // ─── Category modal ────────────────────────────────────────
    function openCategoryModal() {
      editingCatIdx = -1;
      document.getElementById('category-modal').classList.remove('hidden');
      document.getElementById('new-category-input').value = '';
      renderCategoryList();
      setTimeout(() => document.getElementById('new-category-input').focus(), 50);
    }

    function closeCategoryModal() {
      document.getElementById('category-modal').classList.add('hidden');
      editingCatIdx = -1;
    }

    function renderCategoryList() {
      const ul = document.getElementById('category-list');
      if (!categories.length) {
        ul.innerHTML = '<li class="text-center text-gray-400 text-sm py-4">カテゴリがありません</li>';
        return;
      }
      ul.innerHTML = categories.map((cat, i) => {
        const count = memos.filter(m => m.category === cat).length;
        if (i === editingCatIdx) {
          return `<li class="flex items-center gap-2 rounded-xl px-3 py-2 bg-slate-50">
  <input id="edit-cat-input" type="text" value="${esc(cat)}"
    class="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
    onkeydown="if(event.key==='Enter') saveEditCat(${i}); else if(event.key==='Escape') cancelEditCat()"/>
  <button onclick="saveEditCat(${i})" class="icon-btn text-slate-600 hover:bg-slate-100">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
  </button>
  <button onclick="cancelEditCat()" class="icon-btn text-gray-400 hover:bg-gray-100">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
  </button>
</li>`;
        }
        return `<li class="flex items-center gap-1 rounded-xl px-3 py-2 hover:bg-gray-50 group">
  <div class="flex flex-col mr-1">
    <button onclick="moveCat(${i},-1)" ${i===0?'disabled':''} class="icon-btn w-5 h-4 text-gray-300 hover:text-gray-500 ${i===0?'opacity-20 pointer-events-none':''}">
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
    </button>
    <button onclick="moveCat(${i},1)" ${i===categories.length-1?'disabled':''} class="icon-btn w-5 h-4 text-gray-300 hover:text-gray-500 ${i===categories.length-1?'opacity-20 pointer-events-none':''}">
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
    </button>
  </div>
  <span class="flex-1 text-sm text-gray-700">${esc(cat)}</span>
  ${count > 0 ? `<span class="text-xs text-gray-400">${count}件</span>` : ''}
  <button onclick="startEditCat(${i})" class="icon-btn text-gray-300 hover:text-slate-500 hover:bg-slate-50 opacity-0 group-hover:opacity-100 transition-opacity">
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
  </button>
  <button onclick="deleteCat(${i})" class="icon-btn text-gray-300 hover:text-red-400 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity">
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
  </button>
</li>`;
      }).join('');
      if (editingCatIdx >= 0) {
        setTimeout(() => { const el = document.getElementById('edit-cat-input'); if (el) { el.focus(); el.select(); } }, 30);
      }
    }

    function startEditCat(i) { editingCatIdx = i; renderCategoryList(); }
    function cancelEditCat() { editingCatIdx = -1; renderCategoryList(); }

    function saveEditCat(i) {
      const inp  = document.getElementById('edit-cat-input');
      const name = inp ? inp.value.trim() : '';
      if (!name || name === "すべて" || name.length > 100) { alert("カテゴリ名は100文字以内で入力してください。「すべて」は使用できません。"); if (inp) inp.focus(); return; }
      if (name === categories[i]) { cancelEditCat(); return; }
      if (categories.includes(name)) { alert(`「${name}」はすでに存在します`); inp.focus(); return; }
      const old = categories[i];
      categories[i] = name;
      memos.forEach(m => { if (m.category === old) m.category = name; });
      saveData(); editingCatIdx = -1;
      renderCategoryList(); renderModalCategorySelect(); renderTabs(); renderTagFilter(); renderMemoGrid();
    }

    function deleteCat(i) {
      const name  = categories[i];
      const count = memos.filter(m => m.category === name).length;
      const msg   = count > 0
        ? `「${name}」は${count}件のメモで使用中です。\n削除すると別のカテゴリに移動されます。削除しますか？`
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
    }

    function moveCat(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= categories.length) return;
      [categories[i], categories[j]] = [categories[j], categories[i]];
      saveData(); renderCategoryList(); renderModalCategorySelect(); renderTabs();
    }

    function addCategory() {
      const inp  = document.getElementById('new-category-input');
      const name = inp.value.trim();
      if (!name || name === "すべて" || name.length > 100) { alert("カテゴリ名は100文字以内で入力してください。「すべて」は使用できません。"); inp.focus(); return; }
      if (categories.includes(name)) { alert(`「${name}」はすでに存在します`); inp.focus(); return; }
      categories.push(name);
      saveData();
      renderCategoryList(); renderModalCategorySelect(); renderTabs();
      inp.value = ''; inp.focus();
    }

    // ─── Modal category select ────────────────────────────────
    function renderModalCategorySelect() {
      const sel  = document.getElementById('modal-category');
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      if (categories.includes(prev)) sel.value = prev;
    }

    // ─── Tag filter ──────────────────────────────────────────
    function renderTagFilter() {
      const container = document.getElementById('tag-filter');
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
        return `<button onclick="setTagFilter(${jsArg(tag)})"
          class="px-2.5 py-1 rounded-full text-xs border transition-colors whitespace-nowrap
            ${on ? 'bg-slate-700 text-white border-slate-700' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}">
          #${esc(tag)}
        </button>`;
      }).join('');
    }

    function setTagFilter(tag) {
      activeTag = activeTag === tag ? null : tag;
      renderTagFilter(); renderMemoGrid();
    }

    // ─── Modal tags ───────────────────────────────────────────
    function renderModalTags() {
      const list = document.getElementById('modal-tags-list');
      if (!list) return;
      list.innerHTML = modalTags.map((tag, i) =>
        `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-600 border border-slate-200">
          #${esc(tag)}
          <button type="button" onclick="removeModalTag(${i})"
            class="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">✕</button>
        </span>`
      ).join('');
    }

    function handleTagInput(e) {
      if (e.key !== 'Enter') return;
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
      const grid  = document.getElementById('memo-grid');
      const empty = document.getElementById('empty-state');
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

        return `<div class="memo-card relative bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col cursor-pointer" style="min-height:150px" onclick="openMemoView(${jsArg(memo.id)}, event)">
  <span class="absolute top-3 right-3 px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-500 border border-slate-100 max-w-28 truncate">${esc(memo.category)}</span>
  <div class="px-4 pt-4 pb-2 pr-28">
    <p class="font-semibold text-gray-800 text-sm leading-snug">${esc(memo.title)}</p>
  </div>
  <div class="px-4 pb-2 flex-1">
    <p class="text-xs text-gray-500 leading-relaxed" style="display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">${preview}</p>
  </div>
  ${(memo.tags && memo.tags.length) ? `<div class="px-4 pb-2 flex flex-wrap gap-1">${memo.tags.map(t => `<span class="px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-500 border border-slate-200">#${esc(t)}</span>`).join('')}</div>` : ''}
  <div class="px-3 pb-1.5 flex items-center justify-between border-t border-gray-50 pt-1">
    <div class="flex gap-0.5">
      <button onclick="moveMemo(${jsArg(memo.id)},-1)" ${isFirst ? 'disabled' : ''} title="上へ"
        class="icon-btn w-6 h-6 text-gray-300 hover:text-gray-500 hover:bg-gray-100 ${isFirst ? 'opacity-20 pointer-events-none' : ''}">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
      </button>
      <button onclick="moveMemo(${jsArg(memo.id)},1)" ${isLast ? 'disabled' : ''} title="下へ"
        class="icon-btn w-6 h-6 text-gray-300 hover:text-gray-500 hover:bg-gray-100 ${isLast ? 'opacity-20 pointer-events-none' : ''}">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
      </button>
    </div>
    <div class="flex gap-0.5">
      <button onclick="copyMemo(${jsArg(memo.id)}, null)" title="コピー"
        class="icon-btn text-gray-300 hover:text-slate-500 hover:bg-slate-50">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
      </button>
      <button onclick="openMemoModal(${jsArg(memo.id)})" title="編集"
        class="icon-btn text-gray-300 hover:text-slate-500 hover:bg-slate-50">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
      </button>
      <button onclick="deleteMemo(${jsArg(memo.id)})" title="削除"
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
      const toast = document.getElementById('toast');
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
      if (e?.target.closest("button")) return;
      if (e && e.target.closest('button')) return;
      const memo = memos.find(m => m.id === id);
      if (!memo) return;
      viewingMemoId = id;
      document.getElementById('view-title').textContent = memo.title;
      document.getElementById('view-category').textContent = memo.category;
      const viewBodies = memo.bodies && memo.bodies.length ? memo.bodies : (memo.body !== undefined ? [memo.body] : []);
      const viewBodyContainer = document.getElementById('view-body-container');
      const nonEmptyBodies = viewBodies.filter(b => b && b.trim());
      viewBodyContainer.innerHTML = nonEmptyBodies.map((b, i) =>
        `${i > 0 ? '<div style="border-top:1.5px dashed #d1d5db;margin:12px 0"></div>' : ''}
         <p class="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap select-text">${linkifyText(b)}</p>`
      ).join('');
      const notesWrap = document.getElementById('view-notes-wrap');
      const notes = memo.notes || (memo.note ? [memo.note] : []);
      if (notes.length) {
        notesWrap.classList.remove('hidden');
        notesWrap.innerHTML = notes.map(n =>
          `<p class="text-xs text-gray-400 leading-relaxed select-text break-all">${linkifyText(n)}</p>`
        ).join('');
      } else {
        notesWrap.classList.add('hidden');
      }
      const tagsEl = document.getElementById('view-tags');
      if (memo.tags && memo.tags.length) {
        tagsEl.classList.remove('hidden');
        tagsEl.innerHTML = memo.tags.map(t => `<span class="px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-500 border border-slate-200">#${esc(t)}</span>`).join('');
      } else {
        tagsEl.classList.add('hidden');
      }
      const parts = [];
      if (memo.createdAt) parts.push(`作成: ${formatDate(memo.createdAt)}`);
      if (memo.updatedAt && memo.updatedAt !== memo.createdAt) parts.push(`更新: ${formatDate(memo.updatedAt)}`);
      document.getElementById('view-dates').textContent = parts.join('　');
      document.getElementById('view-modal').classList.remove('hidden');
    }

    function closeViewModal() {
      document.getElementById('view-modal').classList.add('hidden');
      viewingMemoId = null;
    }

    function viewEditMemo() {
      const id = viewingMemoId;
      closeViewModal();
      openMemoModal(id);
    }

    function viewDeleteMemo() {
      const memo = memos.find(m => m.id === viewingMemoId);
      if (!memo || !confirm(`「${memo.title}」を削除しますか？`)) return;
      const id = viewingMemoId;
      closeViewModal();
      memos = memos.filter(m => m.id !== id);
      saveData();
      renderTagFilter(); renderMemoGrid();
    }

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

    function signInWithGoogle() { localStorage.setItem('works_pending_destination', '/memo/'); signIn('/tutor/'); }
    async function signOutUser() {
      if ((pendingSaves || saveFailed || !document.querySelector('#export-draft').hidden) && !confirm('未保存の変更があります。ログアウトしますか？')) return;
      await worksSignOut(); location.reload();
    }
    watchAuth({
      onSignedIn: async () => {
        try {
          await loadData();
          document.querySelector('#login-screen').classList.add('hidden');
          document.querySelector('#memo-user-bar').hidden = false;
        } catch (error) { document.querySelector('#login-loading').textContent = '読み込みに失敗しました: ' + error.message; }
      },
      onSignedOut: message => {
        document.querySelector('#login-loading').classList.add('hidden');
        document.querySelector('#login-form').classList.remove('hidden');
        if (message) document.querySelector('#login-form p').textContent = message;
      }
    });
    // Card actions already have their own handler; ignore their bubbling view event.
    for (const modal of document.querySelectorAll('[id$="modal"]')) {
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
      modal.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const items = [...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(el => !el.disabled && el.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      });
    }
    document.querySelector('.works-home').onclick = event => {
      if ((pendingSaves || saveFailed || !document.querySelector('#export-draft').hidden || !document.querySelector('#memo-modal').classList.contains('hidden')) && !confirm('未保存の変更がある可能性があります。移動しますか？')) event.preventDefault();
    };
    // ─── Expose globals ───────────────────────────────────────
    Object.assign(window, {
      exportDraft, setTab,
      openCategoryModal, closeCategoryModal,
      addCategory, startEditCat, cancelEditCat, saveEditCat, deleteCat, moveCat,
      openMemoModal, closeMemoModal, saveMemo,
      addModalBody, removeModalBody, moveModalBody,
      addModalNote, removeModalNote,
      deleteMemo, moveMemo, copyMemo,
      openMemoView, closeViewModal, viewEditMemo, viewDeleteMemo, viewCopyMemo,
      setTagFilter, handleTagInput, removeModalTag,
      signInWithGoogle, signOutUser,
    });
