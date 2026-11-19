// Match Tutor's content-sized textareas across input, async panels and width changes.
export function observeTeachingInputs(root){
 let alive=true,frame=0,width=0;
 const resize=()=>{frame=0;if(!alive)return;for(const input of root.querySelectorAll('textarea')){if(!input.getClientRects().length)continue;input.style.height='auto';const style=getComputedStyle(input);input.style.height=`${input.scrollHeight+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth)}px`;}};
 const schedule=()=>{if(alive&&!frame)frame=requestAnimationFrame(resize);};
 const mutations=new MutationObserver(schedule);mutations.observe(root,{childList:true,subtree:true});
 const sizes=new ResizeObserver(([entry])=>{if(entry.contentRect.width!==width){width=entry.contentRect.width;schedule();}});sizes.observe(root);
 root.addEventListener('input',schedule);document.fonts?.ready.then(schedule);schedule();
 return ()=>{alive=false;if(frame)cancelAnimationFrame(frame);root.removeEventListener('input',schedule);mutations.disconnect();sizes.disconnect();};
}
