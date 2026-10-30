import { hydrateIcons } from './wiki-icons.mjs';
let controller;
const controls='button,input,select,textarea,#detail,#editor,#login,#message,[role="alert"]';
// DOM projection only: no values, disabled flags, handlers, order, API or dialog
// state are changed. Dynamic forms retain their original delegated handlers.
export function decorateWiki(root) {
  const nodes=[...(root.matches?.(controls)?[root]:[]),...root.querySelectorAll(controls)];
  for(const el of nodes) {
    if(el.closest('#body,#editor-preview,.wiki-markdown'))continue;
    if(el.matches('button[role="tab"]')) {
      el.classList.add('nav-link');
    } else if(el.matches('button')) {
      el.classList.add('btn');
      el.classList.add(el.matches('.primary,.ui-primary,.btn-primary,#new,#editor button[type="submit"]')?'btn-solid':'btn-outline');
    } else if(el.matches('input[type="checkbox"]')) {
      el.classList.add('check');
    } else if(el.matches('input:not([type="hidden"]):not([type="radio"]):not([type="file"]),select,textarea')) {
      el.classList.add('form-control');
    }
    if(el.matches('#detail,#editor,#login'))el.classList.add('card');
    if(el.matches('#message,[role="alert"]'))el.classList.add('alert');
  }
}
export function startWikiPresentation() {
  if(controller){controller.start();return controller;}
  let active=false;
  const observer=new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)
      if(node.nodeType===Node.ELEMENT_NODE)decorateWiki(node);
  });
  const start=()=>{
    if(active)return;
    active=true;
    decorateWiki(document.body);
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
