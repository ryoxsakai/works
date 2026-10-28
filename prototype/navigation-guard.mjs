// Framework7 remains the sole router. Stamp history entries so a cancelled native
// Back/Forward traversal can return to its original position without a new entry.
export function installNavigationGuard(currentModule, currentRouter) {
  const nativePush=history.pushState.bind(history),nativeReplace=history.replaceState.bind(history);
  let index=Number(history.state?.worksShellIndex)||0,restoring=false,approvedUrl=null;
  history.pushState=(state,title,url)=>nativePush({...state,worksShellIndex:++index},title,url);
  history.replaceState=(state,title,url)=>nativeReplace({...state,worksShellIndex:index},title,url);
  history.replaceState(history.state,'');
  function popstate(event) {
    if(restoring){restoring=false;event.stopImmediatePropagation();return;}
    let next=event.state?.worksShellIndex;
    // A pasted hash/deep link can create a same-document entry with null state.
    if(!Number.isInteger(next))next=index+1;
    const module=currentModule();
    if(module&&!module.canLeave()) {
      event.stopImmediatePropagation();restoring=true;history.go(index-next);return;
    }
    index=next;
    approvedUrl=location.hash.replace(/^#!/,'')||'/home/';
    nativeReplace({...event.state,worksShellIndex:index},'',location.href);
    // F7's default pop handler infers Back from whether a URL occurred before;
    // revisiting Home makes native Forward ambiguous. Use the stamped browser
    // position and the same public F7 router to render the exact destination.
    event.stopImmediatePropagation();
    currentRouter()?.navigate(approvedUrl,{browserHistory:false,history:false,reloadAll:true,animate:false});
  }
  window.addEventListener('popstate',popstate,true);
  return {
    beforeLeave({to,resolve,reject}) {
      if(approvedUrl===to.url){approvedUrl=null;resolve();return;}
      if(!currentModule()||currentModule().canLeave())resolve();else reject();
    },
    settled(){approvedUrl=null;},
    dispose(){history.pushState=nativePush;history.replaceState=nativeReplace;window.removeEventListener('popstate',popstate,true);},
  };
}
