// One Framework7 panel serves desktop navigation and the mobile drawer.
export function createSidebarController(panel,{background,openerSelector='.page-current [data-menu-open]'}={}) {
 const element=panel.el,media=matchMedia('(min-width: 1024px)'),lifetime=new AbortController();
 let modal=false,opener,restoreFocus=true,previousOverflow,previousBackground=[];
 const buttons=()=>document.querySelectorAll('[data-menu-open]');
 const focusables=()=>[...element.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')].filter(node=>!node.disabled&&node.tabIndex>=0&&node.getClientRects().length);
 function release(restore=true){
  const wasModal=modal;modal=false;document.documentElement.classList.remove('drawer-open');
  // Framework7 can retain its backdrop after an interrupted opening transition.
  // Releasing a genuinely closed panel must release that owned overlay as well.
  if(!panel.opened||!element.classList.contains('panel-in'))panel.backdropEl?.classList.remove('panel-backdrop-in');
  buttons().forEach(button=>button.setAttribute('aria-expanded','false'));
  if(previousOverflow){[document.documentElement.style.overflow,document.body.style.overflow]=previousOverflow;previousOverflow=null;}
  for(const [node,inert,hidden] of previousBackground){node.inert=inert;if(hidden===null)node.removeAttribute('aria-hidden');else node.setAttribute('aria-hidden',hidden);}previousBackground=[];
  element.removeAttribute('aria-modal');element.removeAttribute('role');element.inert=!media.matches;element.setAttribute('aria-hidden',String(!media.matches));
  if(wasModal&&restore&&opener?.closest('.page-current')&&opener.getClientRects().length&&!document.querySelector('#app').hidden)opener.focus();
 }
 function lock(){
  if(media.matches){release(false);return;}
  if(modal)return;modal=true;document.documentElement.classList.add('drawer-open');element.inert=false;element.setAttribute('aria-hidden','false');element.setAttribute('role','dialog');element.setAttribute('aria-modal','true');
  previousOverflow=[document.documentElement.style.overflow,document.body.style.overflow];document.documentElement.style.overflow='hidden';document.body.style.overflow='hidden';
  previousBackground=background.map(node=>[node,node.inert,node.getAttribute('aria-hidden')]);for(const [node]of previousBackground){node.inert=true;node.setAttribute('aria-hidden','true');}
  buttons().forEach(button=>button.setAttribute('aria-expanded','true'));
 }
 function opened(){if(media.matches||!panel.opened||!element.classList.contains('panel-in')){release(false);return;}lock();(element.querySelector('[aria-current=page]')||focusables()[0])?.focus();}
 function closed(){if(!media.matches&&panel.opened&&element.classList.contains('panel-in')){lock();return;}release(restoreFocus);restoreFocus=true;}
 function close({restore=true,animate=false}={}){if(media.matches)return;restoreFocus=restore;panel.close(animate);if(!panel.opened)release(restore);}
 function resize(){
  const focused=element.contains(document.activeElement);panel.close(false);release(false);
  panel.backdropEl?.classList.remove('panel-backdrop-in');document.documentElement.classList.remove('with-panel','with-panel-closing','with-panel-left-cover','with-panel-left-reveal');
  if(media.matches)element.classList.remove('panel-in','panel-out');
  else if(focused)requestAnimationFrame(()=>document.querySelector(openerSelector)?.focus());
 }
 panel.on('open',lock);panel.on('opened',opened);panel.on('closed',closed);panel.on('breakpoint',resize);
 // A backdrop tap can arrive during the opening transition. Use the same
 // synchronous close as Escape so a missing transitionend cannot retain inert/scroll locks.
 panel.backdropEl?.addEventListener('click',()=>{if(modal)close();},{capture:true,signal:lifetime.signal});
 media.addEventListener('change',resize,{signal:lifetime.signal});
 document.addEventListener('keydown',event=>{if(!modal)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key==='Tab'){const items=focusables();if(!items.length){event.preventDefault();return;}const first=items[0],last=items.at(-1);if(event.shiftKey&&(document.activeElement===first||!element.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!element.contains(document.activeElement))){event.preventDefault();first.focus();}}},{capture:true,signal:lifetime.signal});
 document.addEventListener('focusin',event=>{if(modal&&!element.contains(event.target))focusables()[0]?.focus();},{signal:lifetime.signal});
 for(const name of ['wheel','touchmove'])document.addEventListener(name,event=>{if(modal&&!element.contains(event.target))event.preventDefault();},{capture:true,passive:false,signal:lifetime.signal});
 release(false);
 return {get open(){return modal;},open(button){if(media.matches)return;opener=button;restoreFocus=true;panel.open(!matchMedia('(prefers-reduced-motion: reduce)').matches);},close,dispose(){close({restore:false});release(false);lifetime.abort();panel.off('open',lock);panel.off('opened',opened);panel.off('closed',closed);panel.off('breakpoint',resize);}};
}
