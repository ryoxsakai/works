// Opening a day must not issue every student's dependent reads simultaneously.
// Writes are never delayed behind the read queue; each record owns its write queue.
export function boundedTeachingRequests(request,signal,limit=3){
 let running=0;const queued=[];const aborted=()=>new DOMException('Teaching view closed','AbortError');
 function drain(){while(running<limit&&queued.length){const job=queued.shift();if(signal.aborted||job.options.signal?.aborted){job.reject(aborted());continue;}running++;Promise.resolve().then(()=>{if(signal.aborted||job.options.signal?.aborted)throw aborted();return request(job.path,job.options);}).then(job.resolve,job.reject).finally(()=>{running--;drain();});}}
 signal.addEventListener('abort',()=>{for(const job of queued.splice(0))job.reject(aborted());},{once:true});
 return (path,options={})=>{if(signal.aborted||options.signal?.aborted)return Promise.reject(aborted());if(options.method&&options.method!=='GET')return request(path,options);return new Promise((resolve,reject)=>{queued.push({path,options,resolve,reject});drain();});};
}
