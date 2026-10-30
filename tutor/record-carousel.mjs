import Carousel from '../shared/ui/vendor/bootstrap-6.0.0-alpha.1/carousel.js';

const enhancements = new WeakMap();

// One existing row DOM per record: no clones, no autoplay, and no persistence.
export function attachRecordCarousel(root) {
  if (enhancements.has(root)) return enhancements.get(root);
  const element = root.closest('.table-scroll');
  element.classList.add('record-carousel');
  const controls = document.createElement('div');
  controls.className = 'record-carousel-controls';
  controls.innerHTML = '<button type="button" class="btn btn-outline" aria-label="前の授業カード">←</button><span role="status" aria-live="polite"></span><button type="button" class="btn btn-outline" aria-label="次の授業カード">→</button>';
  element.prepend(controls);
  const [prev,next] = controls.querySelectorAll('button'), position=controls.querySelector('span');
  const mobile=matchMedia('(max-width: 640px)'), reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let instance=null, selected=null, printing=false;
  const rows=()=>[...root.children].filter(row=>row.querySelector('.record-student-link,.lesson-record-review,.calendar-record-reconcile,.record-empty-label'));
  const identity=row=>row?.dataset.eventId || row?.textContent.trim().slice(0,100);
  function update() {
    const items=rows(), active=items.findIndex(row=>row.classList.contains('active'));
    const index=Math.max(0,active);
    selected=identity(items[index]);
    position.textContent=items.length ? `${index+1} / ${items.length}件` : '0件';
    if (index===0 && document.activeElement===prev && items.length>1) next.focus({preventScroll:true});
    if (index>=items.length-1 && document.activeElement===next && items.length>1) prev.focus({preventScroll:true});
    prev.disabled=index===0;next.disabled=index>=items.length-1;
  }
  function stop() {
    instance?.dispose();instance=null;
    element.classList.remove('carousel');root.classList.remove('carousel-inner');
    for(const row of root.children)row.classList.remove('carousel-item','active');
    root.scrollLeft=0;controls.hidden=true;
  }
  function start() {
    stop();
    const items=rows();if(!mobile.matches||printing||!items.length)return;
    element.classList.add('carousel');root.classList.add('carousel-inner');
    items.forEach(row=>row.classList.add('carousel-item'));
    const initial=Math.max(0,items.findIndex(row=>identity(row)===selected));
    items[initial].classList.add('active');controls.hidden=items.length<2;
    instance=new Carousel(element,{autoplay:false,ends:'stop',keyboard:true,pause:false});
    // Retain the selected record when reinitializing for orientation/motion.
    root.scrollTo({left:items[initial].offsetLeft-items[0].offsetLeft,behavior:'instant'});
    update();
  }
  // A native gesture must cancel any in-flight programmatic animation.
  // Use the public lifecycle API, preserving the same rows and scroll position.
  const interrupt = ()=>{ instance?.dispose(); instance=null; };
  const resume = ()=>{ if(!instance && mobile.matches && !printing && root.classList.contains('carousel-inner')) { instance=new Carousel(element,{autoplay:false,ends:'stop',keyboard:true,pause:false}); update(); } };
  root.addEventListener('pointerdown',interrupt);
  window.addEventListener('pointerup',resume);
  window.addEventListener('pointercancel',resume);
  prev.addEventListener('click',()=>instance?.prev());
  next.addEventListener('click',()=>instance?.next());
  element.addEventListener('slid.bs.carousel',update);
  // Focused off-screen controls become visible through native scroll-snap.
  const onFocus = ()=>requestAnimationFrame(update);
  root.addEventListener('focusin',onFocus);
  const observer=new MutationObserver(start);observer.observe(root,{childList:true});
  mobile.addEventListener('change',start);reduced.addEventListener('change',start);
  const beforePrint=()=>{printing=true;stop();},afterPrint=()=>{printing=false;start();};
  window.addEventListener('beforeprint',beforePrint);window.addEventListener('afterprint',afterPrint);
  window.addEventListener('pagehide',stop);window.addEventListener('pageshow',start);
  start();
  const enhancement = {destroy(){enhancements.delete(root);root.removeEventListener('focusin',onFocus);root.removeEventListener('pointerdown',interrupt);window.removeEventListener('pointerup',resume);window.removeEventListener('pointercancel',resume);observer.disconnect();stop();controls.remove();mobile.removeEventListener('change',start);reduced.removeEventListener('change',start);window.removeEventListener('beforeprint',beforePrint);window.removeEventListener('afterprint',afterPrint);window.removeEventListener('pagehide',stop);window.removeEventListener('pageshow',start);element.removeEventListener('slid.bs.carousel',update);}};
  enhancements.set(root,enhancement);
  return enhancement;
}
