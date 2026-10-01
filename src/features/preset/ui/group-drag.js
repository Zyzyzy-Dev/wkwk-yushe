// 预设整组拖拽手势：桌面指针/手机长按共用边界落点，短按仍折叠。
export function installPresetGroupDrag(root, { prepare, resolve, commit, lock, unlock, scrollEdge }) {
  const abort = new AbortController(), signal = abort.signal;
  let drag = null, raf = 0, marker = null, edgeKey = '', edgeSince = 0, suppressUntil = 0;
  const clearMarker = () => { marker?.classList.remove('pcm-whole-before','pcm-whole-after','pcm-whole-end'); marker=null; };
  function cancel() {
    if (!drag) return;
    const previous=drag; drag=null; clearTimeout(previous.timer); cancelAnimationFrame(raf); raf=0; clearMarker();
    previous.group.classList.remove('pcm-whole-dragging');root.classList.remove('pcm-whole-drag-active');
    if(previous.active){suppressUntil=performance.now()+450;unlock();}
    if(previous.kind==='pointer'&&root.hasPointerCapture?.(previous.id))root.releasePointerCapture(previous.id);
  }
  function locate() {
    clearMarker();drag.target=null;
    if(Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<12)return;
    const hit=document.elementFromPoint(drag.x,drag.y), list=hit?.closest('.pcm-list[data-list]');
    if(!list||!root.contains(list))return;
    const section=hit.closest('.pcm-group:not(.pcm-uninjected)');
    // 未注入区域不是分组排序区；已有条目内部也只吸附到整组前后。
    if(hit.closest('.pcm-uninjected'))return;
    let after=true;
    if(section){const rect=section.getBoundingClientRect();after=drag.y>rect.top+rect.height/2;}
    const target=resolve(drag.data,list.dataset.list,section,after);
    if(!target)return;
    drag.target=target;marker=section||list;marker.classList.add(section?(after?'pcm-whole-after':'pcm-whole-before'):'pcm-whole-end');
  }
  function tick() {
    if(!drag?.active)return;
    if(!drag.group.isConnected){cancel();return;}
    const edge=scrollEdge(drag.x,drag.y),key=edge?edge.list.dataset.list+':'+edge.dir:'';
    if(key!==edgeKey){edgeKey=key;edgeSince=performance.now();}
    if(edge&&performance.now()-edgeSince>=450){const before=edge.list.scrollTop;edge.list.scrollTop+=edge.delta;if(edge.list.scrollTop!==before)locate();}
    raf=requestAnimationFrame(tick);
  }
  function begin() {
    if(!drag||drag.active)return;
    drag.active=true;drag.group.classList.add('pcm-whole-dragging');root.classList.add('pcm-whole-drag-active');lock();
    if(drag.kind==='pointer')root.setPointerCapture?.(drag.id);
    edgeKey='';edgeSince=0;locate();tick();
  }
  function start(event, point, kind) {
    if(drag)return;
    const head=event.target.closest?.('.pcm-group-head'),group=head?.closest('.pcm-group[data-group-id]');
    if(!group||event.target.closest('.pcm-group-actions,input,select,textarea,a'))return;
    const data=prepare(group.dataset.groupSide,group.dataset.groupId);if(!data)return;
    drag={group,data,kind,id:point.identifier??point.pointerId,x:point.clientX,y:point.clientY,startX:point.clientX,startY:point.clientY,active:false,target:null};
    if(kind==='touch')drag.timer=setTimeout(begin,450);
  }
  function move(event, point) {
    drag.x=point.clientX;drag.y=point.clientY;
    if(!drag.active){const distance=Math.hypot(drag.x-drag.startX,drag.y-drag.startY);if(drag.kind==='touch'){if(distance>8)cancel();return;}if(distance>6)begin();}
    if(drag?.active){event.preventDefault();event.stopPropagation();locate();}
  }
  function end(event,point) {
    if(!drag)return;
    drag.x=point.clientX;drag.y=point.clientY;
    if(drag.active){event.preventDefault();event.stopPropagation();locate();}
    const {data,target,active}=drag;cancel();if(active&&target)commit(data,target);
  }
  root.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'&&e.button===0)start(e,e,'pointer');},{signal});
  root.addEventListener('pointermove',e=>{if(drag?.kind==='pointer'&&drag.id===e.pointerId)move(e,e);},{signal});
  root.addEventListener('pointerup',e=>{if(drag?.kind==='pointer'&&drag.id===e.pointerId)end(e,e);},{signal});
  root.addEventListener('pointercancel',e=>{if(drag?.kind==='pointer'&&drag.id===e.pointerId)cancel();},{signal});
  root.addEventListener('touchstart',e=>{if(e.touches.length!==1){cancel();return;}start(e,e.touches[0],'touch');},{signal,passive:true});
  root.addEventListener('touchmove',e=>{if(drag?.kind!=='touch')return;if(e.touches.length!==1){cancel();return;}const p=[...e.touches].find(p=>p.identifier===drag.id);if(p)move(e,p);},{signal,passive:false});
  root.addEventListener('touchend',e=>{if(drag?.kind!=='touch')return;const p=[...e.changedTouches].find(p=>p.identifier===drag.id);if(p)end(e,p);},{signal,passive:false});
  root.addEventListener('touchcancel',cancel,{signal});
  root.addEventListener('click',e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},{signal,capture:true});
  root.addEventListener('contextmenu',e=>{if(drag||e.target.closest?.('.pcm-group[data-group-id]>.pcm-group-head'))e.preventDefault();},{signal});
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag){e.preventDefault();e.stopImmediatePropagation();cancel();}},{signal,capture:true});
  window.addEventListener('blur',cancel,{signal});
  return {cancel,destroy(){cancel();abort.abort();}};
}
