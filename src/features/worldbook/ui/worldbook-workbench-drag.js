// 世界书手势：空白区滑动列表、长按拖拽、边缘停留滚动与取消清理。
export function installWorkbenchDrag(element,{canDrag,onDrop}) {
  let gesture=null,timer=null,frame=null,marker=null,edge=null,suppressUntil=0;
  const controller=new AbortController(),options={signal:controller.signal};
  function clear(){
    clearTimeout(timer);cancelAnimationFrame(frame);timer=frame=null;edge=null;
    marker?.remove();marker=null;element.classList.remove('is-dragging');
    const current=gesture;gesture=null;
    if(current?.handle.hasPointerCapture?.(current.id))current.handle.releasePointerCapture(current.id);
  }
  function targetAt(){
    if(!gesture)return null;
    const hit=document.elementFromPoint(gesture.x,gesture.y),list=hit?.closest('.pcm-wb-list');
    if(!list||!element.contains(list))return null;
    const row=hit.closest('[data-wb-id]'),rect=row?.getBoundingClientRect();
    return {toSide:list.dataset.side,anchorId:row?.dataset.wbId||null,after:rect?gesture.y>rect.top+rect.height/2:true,row,list};
  }
  function scrollAtEdge(target,now){
    // 命中可见边缘及其外侧窄区，而非只认列表内部；覆盖手机视口裁切。
    const header=element.querySelector('.pcm-wb-header')?.getBoundingClientRect(),viewport=window.visualViewport;
    const viewportTop=Math.max(viewport?.offsetTop||0,header?.bottom||0),viewportBottom=(viewport?.offsetTop||0)+(viewport?.height||window.innerHeight);
    let candidate=null;
    for(const list of element.querySelectorAll('.pcm-wb-list')){
      const r=list.getBoundingClientRect(),top=Math.max(r.top,viewportTop),bottom=Math.min(r.bottom,viewportBottom);
      if(bottom-top<30||gesture.x<r.left-22||gesture.x>r.right+22)continue;
      const direction=gesture.y>=top-22&&gesture.y<top+35?-1:gesture.y>bottom-35&&gesture.y<=bottom+22?1:0;
      const distance=Math.abs(gesture.y-(direction<0?top:bottom));
      if(direction&&(!candidate||distance<candidate.distance))candidate={scroller:list,direction,distance};
    }
    const scroller=candidate?.scroller||(!target?element.closest('.pcm-dialog'):null);
    if(!scroller){edge=null;return;}
    const direction=candidate?.direction||(gesture.y<viewportTop+20?-1:gesture.y>viewportBottom-35?1:0);
    const canScroll=direction<0?scroller.scrollTop>0:direction>0&&scroller.scrollTop+scroller.clientHeight<scroller.scrollHeight-1;
    if(!direction||!canScroll){edge=null;return;}
    // 快速穿过边界不滚动；停留计时绑定列表及方向，允许手指在边缘轻微晃动。
    if(!edge||edge.scroller!==scroller||edge.direction!==direction){
      edge={scroller,direction,x:gesture.x,y:gesture.y,since:now,last:now};return;
    }
    const elapsed=now-edge.since,delta=Math.min(32,now-edge.last);edge.last=now;
    if(elapsed>=350)scroller.scrollTop+=direction*delta*.4*Math.min(1,(elapsed-350)/200);
  }
  function draw(now=performance.now()){
    if(!gesture?.active)return;
    const target=targetAt();
    if(target){
      if(!marker){marker=document.createElement('div');marker.className='pcm-wb-drop-marker';}
      if(marker.parentElement!==target.list)target.list.append(marker);
      const rect=target.list.getBoundingClientRect(),rowRect=target.row?.getBoundingClientRect();
      marker.style.top=(rowRect?(target.after?rowRect.bottom:rowRect.top)-rect.top+target.list.scrollTop:target.list.scrollHeight-3)+'px';
    }else{marker?.remove();marker=null;}
    scrollAtEdge(target,now);frame=requestAnimationFrame(draw);
  }
  function start(){if(!gesture||gesture.scrolling)return;gesture.active=true;element.classList.add('is-dragging');draw();}
  element.addEventListener('pointerdown',event=>{
    if(gesture){if(event.pointerId!==gesture.id)clear();return;}
    const dragZone=event.target.closest('.pcm-wb-drag'),row=event.target.closest('[data-wb-id]');
    if(!row||event.button!==0||event.isPrimary===false)return;
    if(event.target.closest('input,select,button,textarea,a,[contenteditable=true]'))return;
    if(!dragZone&&event.pointerType==='touch')return;
    const handle=dragZone||row,list=row.closest('.pcm-wb-list'),side=list?.dataset.side;
    const allowed=canDrag(side,row.dataset.wbId);
    if(!allowed&&event.pointerType!=='touch')return;
    gesture={id:event.pointerId,handle,list,fromSide:side,idValue:row.dataset.wbId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,lastY:event.clientY,active:false,scrolling:false,touch:event.pointerType==='touch'};
    if(gesture.touch)event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    if(gesture.touch&&allowed)timer=setTimeout(start,300);
  },options);
  element.addEventListener('contextmenu',event=>{if(event.target.closest('.pcm-wb-drag'))event.preventDefault();},options);
  element.addEventListener('selectstart',event=>{
    const target=event.target instanceof Element?event.target:event.target?.parentElement;
    if(target?.closest('.pcm-wb-drag'))event.preventDefault();
  },options);
  window.addEventListener('pointermove',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    gesture.x=event.clientX;gesture.y=event.clientY;
    const distance=Math.hypot(gesture.x-gesture.startX,gesture.y-gesture.startY);
    if(!gesture.active){
      if(gesture.touch&&distance>8){clearTimeout(timer);gesture.scrolling=true;}
      if(!gesture.touch&&distance>5)start();
    }
    // 蓝框禁用了默认手势，短滑只滚动它所属的列表，保持长按后的指针连续。
    if(gesture.scrolling){gesture.list.scrollTop+=gesture.lastY-gesture.y;gesture.lastY=gesture.y;}
    if(gesture.active||gesture.scrolling)event.preventDefault();
  },{...options,passive:false});
  window.addEventListener('pointerup',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    gesture.x=event.clientX;gesture.y=event.clientY;
    const current=gesture,target=current.active?targetAt():null;
    if(current.active||current.scrolling)suppressUntil=performance.now()+300;
    clear();if(target)onDrop({fromSide:current.fromSide,id:current.idValue,toSide:target.toSide,anchorId:target.anchorId,after:target.after});
  },options);
  window.addEventListener('pointercancel',event=>{if(gesture?.id===event.pointerId)clear();},options);
  window.addEventListener('blur',clear,options);
  element.addEventListener('click',event=>{if(performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}}, {...options,capture:true});
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&gesture){event.preventDefault();event.stopImmediatePropagation();clear();}},{...options,capture:true});
  return {cancel:clear,destroy(){clear();controller.abort();}};
}
