import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../tutor/app.js',import.meta.url),'utf8');
const fn=name=>{const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);return source.slice(source.slice(0,start).endsWith('async ')?start-6:start,source.indexOf('\n}',start)+2);};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const context=()=>{
 const state=vm.createContext({studentPrefSaves:new Map(),loadedPrefName:"田崎",studentGeneration:0,studentGroup:'代官山 · 個別',selectedTermIds:new Set(),terms:[],years:[],selectedCalendarIds:new Set(['d','t']),studentChoices:[{name:'田崎',group:'代官山 · 個別',calendarIds:['d']},{name:'田崎',group:'TOMAS',calendarIds:['t']}],studentKinds:{},calendarColors:new Map([['d',{name:'代官山'}],['t',{name:'TOMAS'}]]),
 els:{curriculumName:{value:'田崎'},curriculumYearSelect:{value:'1'},curriculumTermSelect:{value:'1'},pageTabBtns:[],curriculumPrintNameInput:{},actionError:{},curriculumSearchModal:{close(){}}},
 errors:[],loads:[],document:{querySelectorAll:()=>[]},alignCurriculumTermWithSettings(){},renderCurriculumSearchSummary(){},saveCurriculumState(){},renderCurriculumTermOptions(){},renderStudentSelector(){},renderCurriculumNameSuggestions(){},setStudentBusy(){},clearStudentDetails(){},
 loadCurriculumEvents:async()=>{},loadGoals:async()=>{},loadCandidateSchools:async()=>{},loadStudentPref:async()=>{},loadStudentMaterials:async()=>{},curriculumSelectionName:n=>n,isGroupLessonTitle:()=>false,isNonLessonSelectionTitle:()=>false,
 });
 state.clearStudentDetails=()=>{state.studentGeneration++;};state.showActionError=err=>state.errors.push(err.message);
 for(const name of ['captureStudentContext','isCurrentStudentContext','assertStudentContext','saveStudentPref','refreshStudentDetails','curriculumGroupForCalendar','goToCurriculum'])vm.runInContext(fn(name),state);
 return state;
};
let s=context();s.refreshStudentDetails=async()=>{};
await s.goToCurriculum('田崎',undefined,'t');assert.equal(s.studentGroup,'TOMAS');
await s.goToCurriculum('田崎',undefined,'d');assert.equal(s.studentGroup,'代官山 · 個別');
console.log('PASS source classroom in both directions');
s=context();s.studentChoices=[];s.refreshStudentDetails=async()=>{};await s.goToCurriculum('田崎',undefined,'t');assert.equal(s.studentChoices[0].calendarIds[0],'t');
console.log('PASS missing schedule source is retained');
assert.match(source,/record-student-link[^\n]+data-calendar-id/);assert.match(source,/event-student-name name-token-text[^\n]+data-calendar-id/);assert.match(source,/cal-event name-token-text[^\n]+data-calendar-id/);
console.log('PASS all three navigation surfaces carry source calendar');
s=context();let gate=deferred();let committed=false;let payload;
s.apiFetch=async(path,options)=>{payload=JSON.parse(options.body);await gate.promise;committed=true;};s.loadStudentPref=async()=>{assert.equal(committed,true);s.loads.push('GET');};
const save=s.saveStudentPref('田崎',{print_name:'新印刷名'});const refresh=s.refreshStudentDetails();await new Promise(setImmediate);assert.equal(s.loads.length,0);gate.resolve();await Promise.all([save,refresh]);assert.equal(s.loads.length,1);assert.equal(payload.print_name,'新印刷名');
console.log('PASS profile GET waits for the captured PUT');
s=context();gate=deferred();const writes=[];s.apiFetch=async(path,options)=>{writes.push(JSON.parse(options.body).print_name);if(writes.length===1)await gate.promise;};const one=s.saveStudentPref('田崎',{print_name:'一'});const two=s.saveStudentPref('田崎',{print_name:'二'});await new Promise(setImmediate);assert.deepEqual(writes,['一']);gate.resolve();await Promise.all([one,two]);assert.deepEqual(writes,['一','二']);
console.log('PASS successive edits retain PUT order');
s=context();s.apiFetch=async()=>{throw Error('fixture save failed');};let profileRead=false;s.loadStudentPref=async()=>{profileRead=true;};const failed=s.saveStudentPref('田崎',{print_name:'新'});const failureRefresh=s.refreshStudentDetails();await Promise.allSettled([failed,failureRefresh]);assert.equal(profileRead,false);assert.ok(s.errors.includes('fixture save failed'));await new Promise(setImmediate);s.apiFetch=async()=>({});await s.saveStudentPref('田崎',{print_name:'再試行'});
console.log('PASS failed save blocks stale profile reload and permits retry');
s=context();gate=deferred();s.apiFetch=async()=>{await gate.promise;throw Error('stale failure');};const old=s.saveStudentPref('田崎',{print_name:'旧'});s.els.curriculumName.value='青木';s.studentGeneration++;gate.resolve();await Promise.allSettled([old]);assert.equal(s.errors.length,0);
console.log('PASS old save error does not affect the new student');
assert.match(source,/if \(current && !isNonLessonSelectionTitle\(current\)/);assert.match(fn('renderCurriculumNameSuggestions'),/\.filter\(isStudentSelectionEvent\)/);
console.log('PASS main administrative exclusions survive conflict resolution');
s=context();gate=deferred();const attempts=[];s.apiFetch=async(path,options)=>{const value=JSON.parse(options.body).print_name;attempts.push(value);if(value==='失敗'){await gate.promise;throw Error('first failed');}};const first=s.saveStudentPref('田崎',{print_name:'失敗'});const next=s.saveStudentPref('田崎',{print_name:'次の編集'});gate.resolve();const results=await Promise.allSettled([first,next]);assert.deepEqual(attempts,['失敗','次の編集']);assert.deepEqual(results.map(r=>r.status),['rejected','fulfilled']);
console.log('PASS queued edit is saved after the prior PUT fails');
s=context();s.studentChoices[0].calendarIds=['d','d2'];s.selectedCalendarIds.add('d2');s.calendarColors.set('d2',{name:'代官山'});s.rawEvents=[{summary:'田崎',_calendarId:'d'}];s.studentDirectory=[];s.isWithinSelectedTerms=()=>true;s.isStudentSelectionEvent=()=>true;s.isNonLessonSelectionTitle=()=>false;vm.runInContext(fn('renderCurriculumNameSuggestions'),s);s.renderCurriculumNameSuggestions();assert.deepEqual(Array.from(s.studentChoices[0].calendarIds),['d','d2']);s.selectedCalendarIds.delete('d2');s.renderCurriculumNameSuggestions();assert.deepEqual(Array.from(s.studentChoices[0].calendarIds),['d']);
console.log('PASS rebuilding an existing choice retains only still-selected source calendars');
