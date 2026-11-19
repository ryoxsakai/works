import {icon} from './workflow-icons.mjs';
let controller;
const controls='button,input,select,textarea,[role="alert"],#workflow-feedback';
const glyphs={'refresh':'workflow-refresh','resume-setup':'workflow-guide','global-stop':'workflow-stop'};
// DOM projection only: no values, disabled flags, handlers, order, API or dialog
// state are changed. Dynamic forms retain their original delegated handlers.
export function decorateWorkflow(root) {
  for(const [id,key] of Object.entries(glyphs)) {
    const button=root.id===id?root:root.querySelector('#'+id);
    if(button&&!button.querySelector('.works-icon')){const template=document.createElement('template');template.innerHTML=icon(key);button.prepend(template.content);}
  }
  const nodes=[...(root.matches?.(controls)?[root]:[]),...root.querySelectorAll(controls)];
  for(const el of nodes) {
    if(el.matches('.wf-run'))continue;
    if(el.matches('#workflow-steps button')) {
      el.classList.add('nav-link');
    } else if(el.matches('button')) {
      el.classList.add('btn');
      el.classList.add(el.matches('.ui-primary,button[type="submit"]')?'btn-solid':'btn-outline');
    } else if(el.matches('input[type="checkbox"]')) {
      el.classList.add('check');
    } else if(el.matches('input:not([type="hidden"]):not([type="radio"]):not([type="file"]),select,textarea')) {
      el.classList.add('form-control');
    }
    if(el.matches('[role="alert"],#workflow-feedback'))el.classList.add('alert');
  }
}
export function startWorkflowPresentation() {
  if(controller){controller.start();return controller;}
  let active=false;
  const observer=new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)
      if(node.nodeType===Node.ELEMENT_NODE)decorateWorkflow(node);
  });
  const start=()=>{
    if(active)return;
    active=true;
    decorateWorkflow(document.body);
    observer.observe(document.body,{childList:true,subtree:true});
  };
  const stop=()=>{active=false;observer.disconnect();observer.takeRecords();};
  controller={start,stop};
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',start);
  start();
  return controller;
}
