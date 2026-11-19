// Uses the caller's existing OAuth token. Never refreshes authorization, adds a
// scope, follows an authentication redirect or retries a mutation automatically.
const root='https://www.googleapis.com/calendar/v3';
export function calendarLessonGoogle({accessToken,fetcher=fetch,ownerEmail,attestedCalendars=[]}){
 if(typeof accessToken!=='string'||!accessToken)throw Error('existing Google access token required');
 const path=(calendar,suffix)=>`${root}/calendars/${encodeURIComponent(calendar)}/${suffix}`;
 async function request(url,options={}){
  const res=await fetcher(url,{...options,redirect:'manual',headers:{Authorization:`Bearer ${accessToken}`,...options.headers}});
  if(!res.ok)throw Object.assign(new Error(`Google Calendar request failed (${res.status})`),{status:res.status,code:res.status===403?'CALENDAR_EXISTING_GRANT_INSUFFICIENT':'CALENDAR_REQUEST_FAILED'});
  return res.json();
 }
 return {
  async read(calendar,id){try{return await request(path(calendar,`events/${encodeURIComponent(id)}`));}catch(error){if(error.status===404)return null;throw error;}},
  async privacy(calendar){
   const metadata=await request(`${root}/users/me/calendarList/${encodeURIComponent(calendar)}`);
   if(attestedCalendars.includes(calendar))return {basis:'owner_attested',approved:true,calendar_id:calendar,accessRole:metadata.accessRole,ownerEmail};
   const rules=[],tokens=new Set();let token='';
   do{
    const q=new URLSearchParams({maxResults:'250',showDeleted:'false'});if(token)q.set('pageToken',token);
    const page=await request(path(calendar,`acl?${q}`));
    if(!Array.isArray(page.items))throw Error('incomplete Calendar sharing response');
    rules.push(...page.items);token=page.nextPageToken||'';
    if(token&&(typeof token!=='string'||tokens.has(token)))throw Error('invalid Calendar sharing continuation');tokens.add(token);
   }while(token);
   return {complete:true,calendar_id:calendar,accessRole:metadata.accessRole,rules};
  },
  async patch(calendar,id,body,{ifMatch,sendUpdates}){
   if(typeof ifMatch!=='string'||!ifMatch||sendUpdates!=='none'||Object.keys(body).length!==1||typeof body.description!=='string')throw Error('conditional description-only patch required');
   return request(path(calendar,`events/${encodeURIComponent(id)}?sendUpdates=none`),{method:'PATCH',headers:{'If-Match':ifMatch,'Content-Type':'application/json'},body:JSON.stringify(body)});
  },
 };
}
