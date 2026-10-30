// Only browser callers use this helper. Server/MCP GET readers remain pure.
import {sameLessonEvent} from './lesson-plan.js';
const pendingInitializations=new Map();
export async function readNextLessonWithTemplate(source,request,onTarget=()=>{},scope=request,currentScope=()=>scope){
 const result=await request(`/next-lesson-plan?calendar_id=${encodeURIComponent(source.calendar_id)}&event_id=${encodeURIComponent(source.id)}`);
 if(currentScope()!==scope)throw new DOMException('stale session','AbortError');
 // The controller still reports the changed source, but must do so BEFORE any
 // automatic template mutation for a different student's replacement slot.
 if(!sameLessonEvent(source,result.source))return result;
 if(!result.template_initialization_available||!result.target)return result;
 const key=JSON.stringify([result.target.calendar_id,result.target.id]);
 let scoped=pendingInitializations.get(scope);if(!scoped){scoped=new Map();pendingInitializations.set(scope,scoped);}
 let pending=scoped.get(key);
 if(!pending){pending=request('/next-lesson-plan/initialize',{method:'POST',body:JSON.stringify({source:result.source,target:result.target})});scoped.set(key,pending);}
 let initialized;try{initialized=await pending;}finally{if(scoped.get(key)===pending)scoped.delete(key);if(!scoped.size)pendingInitializations.delete(scope);}
 if(currentScope()!==scope)throw new DOMException('stale session','AbortError');
 if(initialized.target)onTarget(result.target,initialized.target,initialized.record_revision);
 return {...result,target:initialized.target||result.target,record_revision:initialized.record_revision??result.record_revision,lesson_plan:initialized.lesson_plan||'',template_initialization_available:false};
}
