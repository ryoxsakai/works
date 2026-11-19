import { hydrateIcons } from './memo-icons.mjs';
let controller;
const controls='button,input,select,textarea,.memo-card,.todo-modal,#save-status,[role="alert"]';
// DOM projection only: no values, disabled flags, handlers, order, API or dialog
// state are changed. Dynamic forms retain their original delegated handlers.
export function decorateMemo(root) {
  const nodes=[...(root.matches?.(controls)?[root]:[]),...root.querySelectorAll(controls)];
  for(const el of nodes) {
    if(el.closest('#view-body-container,#modal-tags-list'))continue;
    if(el.matches('button.tab-btn')) {
      el.classList.add('nav-link');
    } else if(el.matches('button')) {
      el.classList.add('btn');
      el.classList.add(el.matches('.primary,.bg-slate-700')?'btn-solid':'btn-outline');
    } else if(el.matches('input[type="checkbox"]')) {
      el.classList.add('check');
    } else if(el.matches('input:not([type="hidden"]):not([type="radio"]):not([type="file"]),select,textarea')) {
      el.classList.add('form-control');
    }
    if(el.matches('.memo-card,.todo-modal'))el.classList.add('card');
    if(el.matches('#save-status,[role="alert"]'))el.classList.add('alert');
  }
}
export function startMemoPresentation() {
  if(controller){controller.start();return controller;}
  let active=false;
  const observer=new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)
      if(node.nodeType===Node.ELEMENT_NODE)decorateMemo(node);
  });
  const start=()=>{
    if(active)return;
    active=true;
    decorateMemo(document.body);
    observer.observe(document.body,{childList:true,subtree:true});
  };
  const stop=()=>{active=false;observer.disconnect();observer.takeRecords();};
  controller={start,stop};
  hydrateIcons();
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',start);
  start();
  return controller;
}
