// 世界书工作台指针拖拽：把手拖动、触屏长按、列表自动滚动与取消清理。
export function installWorkbenchDrag(element,{canDrag,onDrop}) {
  let gesture=null,timer=null,frame=null,marker=null,suppressUntil=0;
  const controller=new AbortController(),options={signal:controller.signal};
  function clear(){clearTimeout(timer);cancelAnimationFrame(frame);timer=frame=null;marker?.remove();marker=null;element.classList.remove('is-dragging');gesture=null;}
  function targetAt(){
    if(!gesture)return null;
    const hit=document.elementFromPoint(gesture.x,gesture.y),list=hit?.closest('.pcm-wb-list');
    if(!list||!element.contains(list))return null;
    const row=hit.closest('[data-wb-id]'),rect=row?.getBoundingClientRect();
    return {toSide:list.dataset.side,anchorId:row?.dataset.wbId||null,after:rect?gesture.y>rect.top+rect.height/2:true,row,list};
  }
  function draw(){
    if(!gesture?.active)return;
    marker?.remove();marker=null;const target=targetAt();
    if(target){marker=document.createElement('div');marker.className='pcm-wb-drop-marker';
      if(target.row)target.row[target.after?'after':'before'](marker);else target.list.append(marker);
      const rect=target.list.getBoundingClientRect();if(gesture.y<rect.top+35)target.list.scrollTop-=10;else if(gesture.y>rect.bottom-35)target.list.scrollTop+=10;
    }
    const dialog=element.closest('.pcm-dialog');if(dialog){if(gesture.y<45)dialog.scrollTop-=10;else if(gesture.y>window.innerHeight-45)dialog.scrollTop+=10;}
    frame=requestAnimationFrame(draw);
  }
  function start(){if(!gesture)return;gesture.active=true;element.classList.add('is-dragging');draw();}
  element.addEventListener('pointerdown',event=>{
    const dragZone=event.target.closest('.pcm-wb-drag');const row=event.target.closest('[data-wb-id]');if(!row||event.button!==0||gesture)return;
    if(event.target.closest('input,select,button,textarea,a,[contenteditable=true]'))return;
    if(!dragZone&&event.pointerType==='touch')return;
    const handle=dragZone||row,side=row.closest('[data-side]')?.dataset.side;
    if(!row||!canDrag(side,row.dataset.wbId))return;
    gesture={id:event.pointerId,fromSide:side,idValue:row.dataset.wbId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,active:false,touch:event.pointerType==='touch'};
    if(event.pointerType==='touch')event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    if(gesture.touch)timer=setTimeout(start,300);
  },options);
  element.addEventListener('contextmenu',event=>{if(event.target.closest('.pcm-wb-drag'))event.preventDefault();},options);
  element.addEventListener('selectstart',event=>{
    // 选择文本时目标可能是 Text 节点，先取所属元素再判断拖拽手柄。
    const target=event.target instanceof Element?event.target:event.target?.parentElement;
    if(target?.closest('.pcm-wb-drag'))event.preventDefault();
  },options);
  window.addEventListener('pointermove',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    gesture.x=event.clientX;gesture.y=event.clientY;
    const distance=Math.hypot(gesture.x-gesture.startX,gesture.y-gesture.startY);
    if(!gesture.active){if(gesture.touch&&distance>10){clear();return;}if(!gesture.touch&&distance>5)start();}
    if(gesture?.active)event.preventDefault();
  },{...options,passive:false});
  window.addEventListener('pointerup',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    const current=gesture,target=current.active?targetAt():null;
    if(current.active)suppressUntil=performance.now()+300;
    clear();if(target)onDrop({fromSide:current.fromSide,id:current.idValue,toSide:target.toSide,anchorId:target.anchorId,after:target.after});
  },options);
  window.addEventListener('pointercancel',clear,options);window.addEventListener('blur',clear,options);
  element.addEventListener('click',event=>{if(performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}}, {...options,capture:true});
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&gesture){event.preventDefault();event.stopImmediatePropagation();clear();}},{...options,capture:true});
  return {cancel:clear,destroy(){clear();controller.abort();}};
}


