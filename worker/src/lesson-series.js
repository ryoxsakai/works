import {lessonTitleKey} from '../../shared/lesson-attribution.js';
export const parentIdentity=event=>({id:event?.id,created:event?.created,iCalUID:event?.iCalUID});
export const originalTime=event=>event?.originalStartTime?.dateTime||null;
export async function seriesRules(env,calendarId){
 try{return (await env.DB.prepare('SELECT s.*,o.revision AS owner_revision FROM lesson_series_owners s JOIN lesson_owners o ON o.id=s.owner_id WHERE calendar_id=? ORDER BY anchor_original DESC').bind(calendarId).all()).results;}
 catch(error){if(String(error.message).includes('no such table'))return [];throw error;}
}
export function applicableSeriesRule(event,rules){
 const time=Date.parse(originalTime(event));if(!event?.recurringEventId||!Number.isFinite(time))return null;
 // Pick latest boundary before checking title. Never revive a prior person's rule.
 return rules.filter(r=>r.series_id===event.recurringEventId&&Date.parse(r.anchor_original)<=time).sort((a,b)=>Date.parse(b.anchor_original)-Date.parse(a.anchor_original))[0]||null;
}
export async function seriesParent(calendarId,seriesId,deps){
 if(!deps)return null;const key=JSON.stringify([calendarId,seriesId]);const read=async()=>{const token=(await deps.token()).access_token;return deps.event(token,calendarId,seriesId);};
 if(!deps.seriesParents)return read();if(!deps.seriesParents.has(key))deps.seriesParents.set(key,read());return deps.seriesParents.get(key);
}
export function validSeriesParent(parent,id){return parent?.id===id&&parent.status!=='cancelled'&&Array.isArray(parent.recurrence)&&parent.recurrence.length>0&&typeof parent.created==='string'&&!!parent.created&&typeof parent.iCalUID==='string'&&!!parent.iCalUID;}
export async function resolveSeriesOwner(env,target,event,deps,rules){
 const rule=applicableSeriesRule(event,rules||await seriesRules(env,target.calendar_id));if(!rule)return null;
 let parent;try{parent=await seriesParent(target.calendar_id,rule.series_id,deps);}catch{return {attribution_status:'series_unavailable',attribution_notice:'繰返し系列を確認できません。入力・履歴は保持しています'};}
 if(!validSeriesParent(parent,rule.series_id)||JSON.stringify(parentIdentity(parent))!==rule.parent_identity_json||event.iCalUID!==parent.iCalUID||lessonTitleKey(parent.summary)!==lessonTitleKey(rule.expected_title)||lessonTitleKey(target.title)!==lessonTitleKey(rule.expected_title))return {attribution_status:'series_changed',attribution_notice:'繰返し系列または名前が変わりました。同じ生徒・クラスか確認してください'};
 if(await env.DB.prepare('SELECT calendar_event_id FROM curriculum_entries WHERE calendar_event_id=?').bind(target.id).first())return {attribution_status:'series_legacy_hold',attribution_notice:'この回には未確認の旧記録があります。過去の内容を自動では引き継ぎません'};
 return {attribution_status:'confirmed',owner_id:rule.owner_id,owner_revision:rule.owner_revision,series_rule_id:rule.id,series_rule_revision:rule.revision,series_id:rule.series_id,series_original_time:originalTime(event),series_anchor_original:rule.anchor_original,owner_memo_storage:'owner_id',record_exists:false,record_id:null,record_revision:0};
}
