// 迁移预览内独立的鼠标/触屏长按拖动，落点、边缘滚动及生命周期不触及底层编辑器。
export function installMigrationDrag({modal, box, header, footer, preview, canDrag, onDrop}) {
  const doc=modal.ownerDocument, win=doc.defaultView, listeners=[];
  let drag=null, raf=0, suppressUntil=0, marker=null, markerClass='', edge=0, edgeSince=0;
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
  const rows=()=>[...preview.querySelectorAll('[data-migration-preview-prompt]')].filter(row=>!row.closest('.pcm-uninjected'));
  const clearMarker=()=>{marker?.classList.remove(markerClass);marker=null;markerClass='';};
  function cancel() {
    if(drag?.holding)suppressUntil=Date.now()+400;
    clearTimeout(drag?.timer);if(raf)win.cancelAnimationFrame(raf);raf=0;
    drag?.row.classList.remove('is-migration-dragging');modal.classList.remove('is-migration-drag-active');
    drag=null;edge=0;clearMarker();
  }
  const bounds=()=>{const r=box.getBoundingClientRect();return{left:r.left,right:r.right,top:Math.max(r.top,header.getBoundingClientRect().bottom),bottom:Math.min(r.bottom,footer.getBoundingClientRect().top)};};
  function locate() {
    clearMarker();if(!drag?.holding)return null;
    const {x,y,startX,startY,row:source}=drag,r=bounds();
    if(Math.hypot(x-startX,y-startY)<12||x<r.left||x>r.right||y<r.top||y>r.bottom)return null;
    const hit=doc.elementFromPoint(x,y);
    if(!hit||!preview.contains(hit)||hit.closest('.pcm-uninjected'))return null;
    let row=hit.closest('[data-migration-preview-prompt]'),section=hit.closest('[data-migration-preview-group]');
    if(row===source)return null;
    const all=rows().filter(row=>row!==source),next=row=>all[all.indexOf(row)+1]?.dataset.migrationPreviewPrompt??null;
    let beforeId,groupId;
    if(row){
      const rect=row.getBoundingClientRect(),after=y>rect.top+rect.height/2;
      beforeId=after?next(row):row.dataset.migrationPreviewPrompt;marker=row;markerClass=after?'pcm-migration-drop-after':'pcm-migration-drop-before';
    }else if(section){
      const members=all.filter(row=>row.closest('[data-migration-preview-group]')===section);
      if(!members.length)return null;
      beforeId=next(members.at(-1));marker=section;markerClass='pcm-migration-drop-group';
    }else return null;
    groupId=section?.dataset.migrationPreviewGroup||'';marker.classList.add(markerClass);
    return {beforeId,groupId};
  }
  function tick() {
    if(!drag?.holding)return;
    const r=bounds(),inside=drag.x>=r.left&&drag.x<=r.right&&drag.y>=r.top&&drag.y<=r.bottom;
    const zone=Math.min(56,(r.bottom-r.top)/4),direction=inside?(drag.y<r.top+zone?-1:drag.y>r.bottom-zone?1:0):0;
    if(direction!==edge){edge=direction;edgeSince=Date.now();}
    if(edge&&Date.now()-edgeSince>=450){box.scrollTop+=edge*7;locate();}
    raf=win.requestAnimationFrame(tick);
  }
  function begin() {
    if(!drag||!canDrag()){cancel();return;}
    drag.holding=true;drag.row.classList.add('is-migration-dragging');modal.classList.add('is-migration-drag-active');
    raf=win.requestAnimationFrame(tick);
  }
  function start(event,point,type,id) {
    if(drag)cancel();
    const open=event.target.closest?.('[data-migration-preview-expand]'),row=open?.closest('.is-incoming');
    if(!row||!preview.contains(row)||!canDrag())return;
    drag={row,type,id,startX:point.clientX,startY:point.clientY,x:point.clientX,y:point.clientY,holding:false};
    if(type==='touch')drag.timer=setTimeout(begin,450);
  }
  function move(event,point) {
    if(!drag)return;
    drag.x=point.clientX;drag.y=point.clientY;
    const distance=Math.hypot(drag.x-drag.startX,drag.y-drag.startY);
    if(!drag.holding){if(drag.type==='touch'){if(distance>8)cancel();return;}if(distance<4)return;begin();}
    if(drag?.holding){event.preventDefault();locate();}
  }
  function finish(event,point) {
    if(!drag)return;
    if(point){drag.x=point.clientX;drag.y=point.clientY;}
    const active=drag,placement=locate();
    if(active.holding)event.preventDefault();
    cancel();
    if(active.holding&&placement&&canDrag())onDrop(active.row.dataset.migrationPreviewPrompt,placement);
  }
  listen(modal,'pointerdown',event=>{if(event.pointerType!=='touch'&&event.button===0)start(event,event,'pointer',event.pointerId);});
  listen(doc,'pointermove',event=>{if(drag?.type==='pointer'&&event.pointerId===drag.id)move(event,event);},{capture:true,passive:false});
  listen(doc,'pointerup',event=>{if(drag?.type==='pointer'&&event.pointerId===drag.id)finish(event,event);},true);
  listen(doc,'pointercancel',event=>{if(drag?.type==='pointer'&&event.pointerId===drag.id)cancel();},true);
  listen(modal,'touchstart',event=>{if(event.touches.length!==1){cancel();return;}const p=event.touches[0];start(event,p,'touch',p.identifier);},{passive:true});
  listen(modal,'touchmove',event=>{if(drag?.type!=='touch')return;if(event.touches.length!==1){cancel();return;}const p=[...event.touches].find(p=>p.identifier===drag.id);if(p)move(event,p);},{passive:false});
  listen(modal,'touchend',event=>{if(drag?.type!=='touch')return;const p=[...event.changedTouches].find(p=>p.identifier===drag.id);if(p)finish(event,p);},{passive:false});
  listen(modal,'touchcancel',cancel,{passive:true});listen(win,'blur',cancel);
  listen(modal,'click',event=>{if(event.isTrusted&&Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
  listen(modal,'contextmenu',event=>{if(event.target.closest('.is-incoming [data-migration-preview-expand]'))event.preventDefault();});
  listen(modal,'dragstart',event=>event.preventDefault());
  return {cancel,destroy(){cancel();listeners.forEach(off=>off());}};
}
