import { icon } from './material-icons.mjs';
let controller;
const controls='button,input,select,textarea,.material-panel,[role="alert"]';
// DOM projection only: no values, disabled flags, handlers, order, API or dialog
// state are changed. Dynamic forms retain their original delegated handlers.
export function decorateMaterial(root) {
  for(const old of [...(root.matches?.('i.bx')?[root]:[]),...root.querySelectorAll('i.bx')]) {
    const key=[...old.classList].find(c=>c.startsWith('bx-')&&c!=='bx-spin');
    if(!key)continue;
    const template=document.createElement('template');template.innerHTML=icon(key);
    const svg=template.content.firstElementChild;
    for(const attr of old.attributes)if(!['class','aria-hidden'].includes(attr.name))svg.setAttribute(attr.name,attr.value);
    old.replaceWith(svg);
  }
  const nodes=[...(root.matches?.(controls)?[root]:[]),...root.querySelectorAll(controls)];
  for(const el of nodes) {
    if(el.closest('#material-preview-body'))continue;
    if(el.matches('button[data-material-tab]')) {
      el.classList.add('nav-link');
    } else if(el.matches('button')) {
      el.classList.add('btn');
      el.classList.add(el.matches('.btn-primary')?'btn-solid':'btn-outline');
    } else if(el.matches('input[type="checkbox"]')) {
      el.classList.add('check');
    } else if(el.matches('input:not([type="hidden"]):not([type="radio"]):not([type="file"]),select,textarea')) {
      el.classList.add('form-control');
    }
    if(el.matches('.material-panel'))el.classList.add('card');
    if(el.matches('[role="alert"]'))el.classList.add('alert');
  }
}
export function startMaterialPresentation() {
  if(controller){controller.start();return controller;}
  let active=false;
  const observer=new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)
      if(node.nodeType===Node.ELEMENT_NODE)decorateMaterial(node);
  });
  const start=()=>{
    if(active)return;
    active=true;
    decorateMaterial(document.body);
    observer.observe(document.body,{childList:true,subtree:true});
  };
  const stop=()=>{active=false;observer.disconnect();observer.takeRecords();};
  controller={start,stop};
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',start);
  start();
  return controller;
}
