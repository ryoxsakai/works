import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(source.slice(0, start).endsWith('async ') ? start - 6 : start, source.indexOf('\n}', start) + 2);
}
const periods = [
  { id: 1, year_id: 1, label: '前期', start_date: '2026-04-01', end_date: '2026-07-31' },
  { id: 2, year_id: 1, label: '後期', start_date: '2026-09-01', end_date: '2026-12-20' },
];
const event = (summary, date = '2026-10-17', calendar = 'daikanyama') => ({summary, start:{date}, _calendarId:calendar});
function setup(extra = {}) {
  const state = vm.createContext({
    rawEvents:[], terms:periods, years:[{id:1,label:'2026年度'}], selectedTermIds:new Set([2]),
    selectedCalendarIds:new Set(['daikanyama','tomas','shukutoku']), studentChoices:[], studentGroup:'', studentKinds:{}, studentDirectory:[],
    calendarColors:new Map([['daikanyama',{name:'代官山',raw:'#336699'}],['tomas',{name:'TOMAS',raw:'#cc6600'}],['shukutoku',{name:'淑徳与野',raw:'#5566aa'}]]),
    els:{curriculumName:{value:''},curriculumYearSelect:{value:'1'},curriculumTermSelect:{value:'1'}},
    renderStudentSelector(){}, renderCurriculumSearchSummary(){},
    setStudentBusy(){},saveCurriculumState(){},renderCurriculumTermOptions(){},
    formatDateOnly:()=> '2026-10-17', isExcludedScheduleEvent:ev=>ev.summary==='空き',
    ...extra,
  });
  state.clearStudentDetails = () => { state.cleared = true; };
  for (const name of ['normalizeCurriculumText','tokenizeText','eventMatchesCurriculumName','selectionTitleWithoutAnnotation','isGroupLessonTitle','curriculumSelectionName','isNonLessonSelectionTitle','isStudentSelectionEvent','isWithinSelectedTerms','curriculumGroupForCalendar','renderCurriculumNameSuggestions','alignCurriculumTermWithSettings']) vm.runInContext(fn(name),state);
  vm.runInContext('const TOKEN_DELIMITER_RE = /([\\s　()（）【】\\[\\]・/,、:：\\-])/;',state);
  return state;
}
test('A/M anywhere in the lesson name forces group despite an old individual override', () => {
  const state = setup({rawEvents:[event('英語 A1Sta'),event('Ｍ３High 英語'),event('A9新講座'),event('山田（個別）')]});
  for (const ev of state.rawEvents) state.studentKinds[JSON.stringify([ev._calendarId,state.curriculumSelectionName(ev.summary)])]='individual';
  state.renderCurriculumNameSuggestions();
  assert.equal(state.studentChoices.filter(item=>item.group==='代官山 · 集団').length,3);
  assert.equal(state.studentChoices.find(item=>item.name==='山田').group,'代官山 · 個別');
  assert.equal(state.isGroupLessonTitle('山田（A教室）'),false);
});
test('administrative titles are excluded even with class annotations, while student annotations survive', () => {
  const state=setup();
  for(const title of ['会議','英語科会議（集団授業）','教科会/グループ準備','英語科教科会','WT 作成【個別】','ＷＴ作成／準備','青葉先生と打ち合わせ','職員ミーティング']) assert.equal(state.isNonLessonSelectionTitle(title),true,title);
  for(const title of ['山田（会議後に面談）','A1Sta 英語構文','M3High 英語','田﨑']) assert.equal(state.isNonLessonSelectionTitle(title),false,title);
});
test('designated group courses include both intermediate-course spellings and override old individual settings', () => {
  const state=setup({rawEvents:[event('中堅大英語'),event('英語中堅大'),event('高1長文読解'),event('高１ 長文読解（後期）'),event('高2小尾'),event('田崎'),event('A1 Standard 英語構文'),event('山田（A教室）'),event('高1長文読解',undefined,'tomas')]});
  for(const ev of state.rawEvents) state.studentKinds[JSON.stringify([ev._calendarId,state.curriculumSelectionName(ev.summary)])]='individual';
  state.renderCurriculumNameSuggestions();
  for(const title of ['中堅大英語','英語中堅大','高1長文読解','高１ 長文読解（後期）','A1 Standard 英語構文']) assert.ok(state.studentChoices.some(item=>item.name===title&&item.group==='代官山 · 集団'),title);
  for(const title of ['高2小尾','田崎','山田']) assert.ok(state.studentChoices.some(item=>item.name===title&&item.group==='代官山 · 個別'),title);
  assert.ok(state.studentChoices.some(item=>item.name==='高1長文読解'&&item.group==='TOMAS'));
  for(const title of ['高1長文読解対策','中堅大英語の個別相談','英語中堅大学生']) assert.equal(state.isGroupLessonTitle(title),false,title);
});
test('circle-marked choices, restored selections and source records stay hidden without altering events', () => {
  const rawEvents=[event('冬○'),event('○'),event('高1長文読解○'),event('山田（○）'),event('会議'),event('教科会'),event('WT作成'),event('山田'),event('A1 Standard 英語構文')];
  const before=JSON.stringify(rawEvents);
  const state=setup({rawEvents,studentGroup:'代官山 · 個別',studentChoices:[{name:'冬○',label:'冬○',group:'代官山 · 個別',calendarIds:['daikanyama'],sourceTermId:2}]});
  state.els.curriculumName.value='冬○';
  state.renderCurriculumNameSuggestions();
  assert.deepEqual(new Set(Array.from(state.studentChoices,item=>item.name)),new Set(['山田','A1 Standard 英語構文']));
  assert.equal(state.els.curriculumName.value,'');assert.equal(state.cleared,true);
  assert.equal(JSON.stringify(rawEvents),before);
  assert.equal(state.isNonLessonSelectionTitle('高1長文読解'),false);
});
test('schedule and record navigation filters the original title before annotation removal', async () => {
  const state=setup({studentGroup:'代官山 · 個別',studentChoices:[{name:'山田',label:'山田',group:'代官山 · 個別',calendarIds:['daikanyama']}]});
  state.els.curriculumName.value='山田';
  state.tabClicks=0;state.refreshes=0;
  state.els.pageTabBtns=[{dataset:{pageTab:'curriculum'},click(){state.tabClicks++;}}];
  state.els.actionError={textContent:''};
  state.refreshStudentDetails=async()=>{state.refreshes++;};
  vm.runInContext(fn('goToCurriculum'),state);
  const before=JSON.stringify(state.studentChoices);
  for(const title of ['冬○','山田（○）','A1（○）','会議','WT作成']) await state.goToCurriculum(title,periods[1],'tomas');
  assert.equal(state.tabClicks,0);assert.equal(state.refreshes,0);
  assert.equal(state.els.curriculumName.value,'山田');assert.equal(state.studentGroup,'代官山 · 個別');
  assert.equal(JSON.stringify(state.studentChoices),before);
  await state.goToCurriculum('山田（授業）',periods[1],'tomas');
  assert.equal(state.tabClicks,1);assert.equal(state.refreshes,1);
  assert.equal(state.els.curriculumName.value,'山田');assert.equal(state.studentGroup,'TOMAS');
});
test('only selected term lessons appear; saved old names and administrative selections do not reappear', () => {
  const state=setup({rawEvents:[event('前期のみ','2026-05-01'),event('後期のみ'),event('隙間','2026-08-15'),event('会議') ]});
  state.els.curriculumName.value='前期のみ';state.studentGroup='代官山 · 個別';
  state.renderCurriculumNameSuggestions();
  assert.deepEqual(Array.from(state.studentChoices,item=>item.name),['後期のみ']);
  assert.equal(state.els.curriculumName.value,'');assert.equal(state.cleared,true);
  state.els.curriculumName.value='会議';state.renderCurriculumNameSuggestions();
  assert.equal(state.els.curriculumName.value,'');
});
test('multiple selected terms exclude gaps in their combined fetch range', () => {
  const state=setup({selectedTermIds:new Set([1,2]),rawEvents:[event('前期','2026-07-31'),event('間','2026-08-01'),event('後期','2026-09-01')]});
  state.renderCurriculumNameSuggestions();
  assert.deepEqual(new Set(Array.from(state.studentChoices,item=>item.name)),new Set(['前期','後期']));
});
test('deselected calendars cannot retain students from their old response', () => {
  const state=setup({selectedCalendarIds:new Set(['tomas']),rawEvents:[event('山田'),event('佐藤',undefined,'tomas')]});
  state.els.curriculumName.value='山田';state.renderCurriculumNameSuggestions();
  assert.deepEqual(Array.from(state.studentChoices,item=>item.name),['佐藤']);
  assert.equal(state.els.curriculumName.value,'');
});
test('a current-term record retains its missing source choice until that term is deselected', () => {
  const state=setup({rawEvents:[event('山田')],studentGroup:'TOMAS',studentChoices:[{name:'山田',label:'山田',group:'TOMAS',calendarIds:['tomas'],sourceTermId:2}]});
  state.els.curriculumName.value='山田';state.renderCurriculumNameSuggestions();
  assert.equal(state.studentGroup,'TOMAS');
  assert.ok(state.studentChoices.some(item=>item.group==='TOMAS'));
  state.selectedTermIds=new Set([1]);state.renderCurriculumNameSuggestions();
  assert.equal(state.studentChoices.length,0);assert.equal(state.els.curriculumName.value,'');
});
test('legacy restored tokens follow the actual class group instead of restoring the old individual category', () => {
  const state=setup({rawEvents:[event('A1 Standard 英語構文'),event('山田')]});
  state.els.curriculumName.value='A1';state.studentGroup='代官山 · 個別';state.renderCurriculumNameSuggestions();
  assert.equal(state.studentChoices.find(item=>item.name==='A1').group,'代官山 · 集団');
  assert.equal(state.studentGroup,'代官山 · 集団');
});
test('restored first-term curriculum is aligned to the configured second term', () => {
  const state=setup({rawEvents:[event('山田')]});state.els.curriculumName.value='山田';
  state.renderCurriculumNameSuggestions();state.alignCurriculumTermWithSettings();
  assert.equal(state.els.curriculumTermSelect.value,'2');assert.equal(state.els.curriculumYearSelect.value,'1');
});
test('category order, labels and colors follow the requested calendar hierarchy', () => {
  const state=setup({rawEvents:[event('山田'),event('A1 英語'),event('佐藤',undefined,'tomas'),event('英語',undefined,'shukutoku')]});
  state.renderCurriculumNameSuggestions();
  state.els.studentGroups={innerHTML:''};state.els.studentSelector={innerHTML:'',style:{setProperty(){}},querySelector:()=>null};
  state.document={querySelector:()=>({textContent:''})};state.escapeHtml=value=>value;
  vm.runInContext('const STUDENT_GROUP_ORDER = ["代官山 · 個別", "代官山 · 集団", "TOMAS", "淑徳与野"];',state);
  for(const name of ['studentGroupOrder','studentGroupColor','renderStudentSelector'])vm.runInContext(fn(name),state);
  state.renderStudentSelector();
  const groups=[...state.els.studentGroups.innerHTML.matchAll(/data-student-group="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(groups,['代官山 · 個別','代官山 · 集団','TOMAS','淑徳与野']);
  assert.match(state.els.studentGroups.innerHTML,/--student-color:#336699/);
  assert.match(state.els.studentGroups.innerHTML,/>個別<span/);
});
test('an older calendar request cannot replace a later term refresh', async () => {
  let resolveOld;let calls=0;
  const state=setup({calendarEventsRequest:0,getSessionToken:()=>true,
    fetchCalendarEvents:async()=>++calls===1?await new Promise(resolve=>resolveOld=resolve):[event('最新')],
    readRecordEntries:async()=>[],apiFetch:async()=>[],renderCurrentView(){},renderCurriculumNameSuggestions(){},alignCurriculumTermWithSettings(){},setStudentBusy(){},
  });
  vm.runInContext(fn('loadCalendarEvents'),state);
  const old=state.loadCalendarEvents();await state.loadCalendarEvents();resolveOld([event('古い')]);await old;
  assert.equal(state.rawEvents[0].summary,'最新');
});
test('reloading terms removes deleted IDs and preserves valid selections', async () => {
  const state=setup({selectedTermIds:new Set([1,2,99]),apiFetch:async()=>[periods[1]]});
  vm.runInContext(fn('loadTerms'),state);
  await state.loadTerms();
  assert.deepEqual([...state.selectedTermIds],[2]);
  state.apiFetch=async()=>[periods[0]];
  await state.loadTerms();
  assert.equal(state.selectedTermIds.size,0);
  assert.equal(state.isWithinSelectedTerms(event('remaining year')),true);
  state.els.curriculumTermSelect={innerHTML:''};state.escapeHtml=value=>value;
  vm.runInContext(fn('renderCurriculumTermOptions'),state);
  state.renderCurriculumTermOptions(1);
  assert.match(state.els.curriculumTermSelect.innerHTML,/value="1"/);
});
for (const [target,save,selector] of [
  ['calendarChecklist','saveSelectedCalendars','input[type=checkbox]'],
  ['yearGroups','saveSelectedTerms','.term-checkbox'],
]) {
  function settingsHandler(overrides={}) {
    let handler;
    const state=setup({studentGeneration:0,busy:false,errors:[],
      saveSelectedCalendars:async()=>{},saveSelectedTerms:async()=>{},loadCalendarEvents:async()=>{},loadRecordTable:async()=>{},
      ...overrides,
    });
    state.els[target]={addEventListener(_event,callback){handler=callback;}};
    state.clearStudentDetails=()=>{state.studentGeneration++;};
    state.renderCurriculumNameSuggestions=()=>{};
    state.setStudentBusy=busy=>{state.busy=busy;};
    state.showActionError=error=>state.errors.push(error);
    const start=source.indexOf(`els.${target}.addEventListener("change",`);
    vm.runInContext(source.slice(start,source.indexOf('\n});',start)+4),state);
    const change={target:{closest:query=>query===selector?{checked:true,value:target==='yearGroups'?'2':'tomas'}:null}};
    return {state,run:()=>handler(change)};
  }
  test(`${target} releases busy state after save, calendar, or curriculum failure`,async()=>{
    for(const step of [save,'loadCalendarEvents']) {
      const error=new Error(`${step} unavailable`);
      const {state,run}=settingsHandler({[step]:async()=>{throw error;}});
      await run();
      assert.equal(state.busy,false,step);
      assert.equal(state.errors[0],error);
    }
  });
  test(`${target} failure cannot clear a newer student's busy state`,async()=>{
    let rejectOld;
    const {state,run}=settingsHandler({[save]:()=>new Promise((_resolve,reject)=>{rejectOld=reject;})});
    const pending=run();
    state.studentGeneration++;
    rejectOld(new Error('superseded settings refresh'));
    await pending;
    assert.equal(state.busy,true);
  });
}
