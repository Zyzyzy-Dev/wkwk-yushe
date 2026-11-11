// 条目正文选区工具栏：桌面随选区、触屏靠可视边缘并可换位；保留焦点、草稿、撤销及随机正文块。
import {CREATOR_SYMBOLS,CREATOR_PRIMARY_IDS,planCreatorSymbol} from '../creator-symbols.js';

function selectionPoint(field,index) {
  const doc=field.ownerDocument,cs=doc.defaultView.getComputedStyle(field),mirror=doc.createElement('div'),mark=doc.createElement('span');
  for(const prop of ['boxSizing','paddingTop','paddingRight','paddingBottom','paddingLeft','fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','tabSize','textIndent','textTransform'])mirror.style[prop]=cs[prop];
  Object.assign(mirror.style,{width:field.clientWidth+'px',position:'fixed',visibility:'hidden',top:'0',left:'-9999px',whiteSpace:field.wrap==='off'?'pre':'pre-wrap',overflowWrap:'break-word',wordBreak:cs.wordBreak});
  mirror.textContent=field.value.slice(0,index);mark.textContent='\u200b';mirror.append(mark);doc.body.append(mirror);
  const point={x:mark.offsetLeft,y:mark.offsetTop,height:mark.offsetHeight||parseFloat(cs.lineHeight)||18};mirror.remove();return point;
}

export function installCreatorToolbar({adapter,enabled,onError=()=>{},getEnvironment=()=>({}),onEnvironment}) {
  const area=adapter.area,doc=area.ownerDocument,win=doc.defaultView,editor=area.closest('.pcm-version-editor'),parent=area.closest('.pcm-dialog');
  const toolbar=doc.createElement('div');toolbar.className='pcm-creator-toolbar';toolbar.hidden=true;toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','提示词符号');
  const dockHead=doc.createElement('div');dockHead.className='pcm-creator-dock-head';dockHead.hidden=true;
  const dockLabel=doc.createElement('span');dockLabel.textContent='提示词符号';
  const dockButton=doc.createElement('button');dockButton.type='button';dockButton.dataset.creatorDock='';dockHead.append(dockLabel,dockButton);
  const row=doc.createElement('div');row.className='pcm-creator-row';
  const more=doc.createElement('div');more.className='pcm-creator-more';more.hidden=true;more.setAttribute('role','group');more.setAttribute('aria-label','更多符号与模板');
  const moreButton=doc.createElement('button');moreButton.type='button';moreButton.textContent='更多';moreButton.dataset.creatorMore='';moreButton.setAttribute('aria-expanded','false');
  const tagForm=doc.createElement('form');tagForm.className='pcm-creator-tag-form';tagForm.hidden=true;
  tagForm.innerHTML='<label>标签名称<input name="tagName" aria-label="标签名称" maxlength="64" placeholder="例如：规则" autocomplete="off"></label><div><button type="submit">应用标签</button><button type="button" data-tag-cancel>返回</button></div><small role="status"></small>';
  const tagInput=tagForm.elements.tagName,tagError=tagForm.querySelector('[role=status]');
  toolbar.append(dockHead,row,more,tagForm);parent.append(toolbar);
  let captured=null,composing=false,tagComposing=false,disposed=false,timer=0,frame=0,dismissed=null,touches=0;
  let touchSelection=false,dockPreference=null;
  const pointers=new Set(),keys=new Set();
  const fieldAllowed=field=>field?.tagName==='TEXTAREA'&&editor.contains(field)&&!field.readOnly&&!field.disabled&&!!field.getClientRects().length&&(field===area||!!field.closest('.pcm-random-block-text'));
  const resetMenu=()=>{more.hidden=true;tagForm.hidden=true;tagError.textContent='';moreButton.setAttribute('aria-expanded','false');};
  const cancelPending=()=>{win.clearTimeout(timer);win.cancelAnimationFrame(frame);timer=0;frame=0;};
  const hide=()=>{toolbar.hidden=true;captured=null;resetMenu();};
  const dismiss=()=>{const s=captured;dismissed=s&&{field:s.field,before:s.before,start:s.localStart,end:s.localEnd};cancelPending();hide();return s;};
  function position() {
    frame=0;const saved=captured;if(disposed||toolbar.hidden||!saved?.field.isConnected)return;
    const field=saved.field,point=selectionPoint(field,field.selectionDirection==='backward'?saved.localStart:saved.localEnd),rect=field.getBoundingClientRect(),viewport=win.visualViewport;
    const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||win.innerWidth;
    const docked=touchSelection||win.matchMedia('(pointer: coarse)').matches,environment=getEnvironment()||{};
    // 宿主布局高度与键盘高度配对，避免 iframe 已缩小时再次减去同一键盘高度。
    const hostBottom=Number(environment.viewport?.layoutHeight)>0?environment.viewport.layoutHeight-Math.max(0,Number(environment.keyboardOffset)||0):Infinity;
    const height=Math.max(0,Math.min(top+(viewport?.height||win.innerHeight),docked?hostBottom:Infinity)-top);
    dockHead.hidden=!docked;toolbar.classList.toggle('pcm-creator-docked',docked);
    const x=rect.left+field.clientLeft+point.x-field.scrollLeft;let y=rect.top+field.clientTop+point.y-field.scrollTop;
    if(docked){
      const insets=environment.safeInsets||{},edgeTop=top+Math.max(8,Number(insets.top)||0),edgeBottom=top+height-Math.max(8,Number(insets.bottom)||0);
      toolbar.style.maxWidth=Math.max(0,width-16)+'px';toolbar.style.maxHeight=Math.max(0,edgeBottom-edgeTop)+'px';
      // 首次按选区位置选择远端边缘；用户手动换位后在当前条目内保留，不随菜单展开跳边。
      if(!saved.dock)saved.dock=y<top+height/2?'bottom':'top';
      const side=dockPreference||saved.dock;dockButton.textContent=side==='bottom'?'移到顶部':'移到底部';
      toolbar.style.left=Math.max(left+8,left+(width-toolbar.offsetWidth)/2)+'px';
      toolbar.style.top=(side==='top'?edgeTop:Math.max(edgeTop,edgeBottom-toolbar.offsetHeight))+'px';
      toolbar.dataset.dockSide=side;return;
    }
    delete toolbar.dataset.dockSide;
    const clipTop=Math.max(top,rect.top,parent.getBoundingClientRect().top),clipBottom=Math.min(top+height,rect.bottom,parent.getBoundingClientRect().bottom);
    if(clipBottom<=clipTop){hide();return;}
    if(y+point.height<clipTop||y>clipBottom){
      const other=selectionPoint(field,field.selectionDirection==='backward'?saved.localEnd:saved.localStart),otherY=rect.top+field.clientTop+other.y-field.scrollTop;
      if(Math.max(y+point.height,otherY+other.height)<clipTop||Math.min(y,otherY)>clipBottom){hide();return;}
      // Ctrl+A 或跨多屏选中时，选区端点可能在文本框外；锚定可见部分，仍允许整段操作。
      y=Math.max(clipTop,Math.min(y,clipBottom-point.height));
    }
    toolbar.style.maxWidth=Math.max(0,width-16)+'px';toolbar.style.maxHeight=Math.max(0,height-16)+'px';
    const tw=toolbar.offsetWidth,th=toolbar.offsetHeight;
    const tx=Math.max(left+8,Math.min(x-tw/2,left+width-tw-8));
    let ty=Math.max(top+8,Math.min(y-th-8>=top+8?y-th-8:y+point.height+8,top+height-th-8));
    // 随机转换按钮在选区下方；更多菜单展开时也优先避开它，而不是隐藏随机功能。
    const random=editor.querySelector('.pcm-random-float:not([hidden])')?.getBoundingClientRect();
    if(random&&tx<random.right&&tx+tw>random.left&&ty<random.bottom&&ty+th>random.top){
      const alternatives=[random.top-th-8,random.bottom+8];
      const safe=alternatives.find(value=>value>=top+8&&value+th<=top+height-8);if(safe!==undefined)ty=safe;
    }
    toolbar.style.left=tx+'px';toolbar.style.top=ty+'px';
  }
  function refresh() {
    timer=0;if(disposed||toolbar.contains(doc.activeElement))return;
    const field=doc.activeElement;
    if(!enabled()||composing||pointers.size||touches||keys.size||!editor.isConnected||!fieldAllowed(field)){hide();return;}
    const start=field.selectionStart,end=field.selectionEnd;
    if(start===end||!field.value.slice(start,end).trim()){dismissed=null;hide();return;}
    const before=adapter.getText(),offset=field===area?0:Number(field.dataset.start);
    if(!Number.isInteger(offset)){hide();return;}
    if(dismissed?.field===field&&dismissed.start===start&&dismissed.end===end&&dismissed.before===before){hide();return;}
    captured={field,before,start:offset+start,end:offset+end,localStart:start,localEnd:end};
    toolbar.hidden=false;position();
  }
  // 鼠标/触摸松开、键盘选词结束后再等待选区稳定；原生移动选区手柄用静默间隔兜底。
  const settle=()=>{
    if(disposed||toolbar.contains(doc.activeElement))return;
    // 焦点未动且选区完全相同时，重复的 selectionchange 不能关闭用户刚展开的更多菜单。
    if(captured&&captured.field===doc.activeElement&&area.value===captured.before&&captured.field.selectionStart===captured.localStart&&captured.field.selectionEnd===captured.localEnd&&!pointers.size&&!touches&&!keys.size&&!composing){layout();return;}
    cancelPending();hide();if(!pointers.size&&!touches&&!keys.size&&!composing)timer=win.setTimeout(refresh,280);
  };
  const layout=()=>{if(!disposed&&!toolbar.hidden&&!frame)frame=win.requestAnimationFrame(position);};
  dockButton.addEventListener('click',()=>{dockPreference=toolbar.dataset.dockSide==='bottom'?'top':'bottom';position();});
  function applySymbol(id,options) {
    const saved=captured;if(!saved)return;
    try{
      if(!enabled()||!saved.field.isConnected||saved.field.readOnly||saved.field.disabled||adapter.getText()!==saved.before||saved.field.selectionStart!==saved.localStart||saved.field.selectionEnd!==saved.localEnd)throw Error('正文或选区已变化，请重新选择');
      const edit=planCreatorSymbol(saved.before,saved.start,saved.end,id,options);
      const result=adapter.replace(edit);if(result?.ok===false)throw Error(result.reason);
      adapter.focusRange(edit.selectionStart,edit.selectionEnd);
      const field=doc.activeElement;dismissed={field,before:adapter.getText(),start:field.selectionStart,end:field.selectionEnd};cancelPending();hide();
    }catch(error){if(id==='tag'){tagError.textContent=error.message;layout();}else{hide();onError(error.message);}}
  }
  for(const symbol of CREATOR_SYMBOLS){
    const b=doc.createElement('button');b.type='button';b.textContent=symbol.label;b.dataset.creatorSymbol=symbol.id;b.title=symbol.title;b.setAttribute('aria-label',symbol.title+' '+symbol.label);
    (CREATOR_PRIMARY_IDS.includes(symbol.id)?row:more).append(b);
  }
  row.append(moreButton);
  toolbar.addEventListener('pointerdown',event=>{if(!event.target.closest('input'))event.preventDefault();});
  toolbar.addEventListener('mousedown',event=>{if(!event.target.closest('input'))event.preventDefault();});
  toolbar.addEventListener('click',event=>{
    event.stopPropagation();const button=event.target.closest('[data-creator-symbol]');if(!button)return;
    if(button.dataset.creatorSymbol==='tag'){more.hidden=true;tagForm.hidden=false;tagInput.value='规则';tagError.textContent='';layout();tagInput.focus();tagInput.select();}
    else applySymbol(button.dataset.creatorSymbol);
  });
  moreButton.addEventListener('click',()=>{const open=more.hidden&&tagForm.hidden;resetMenu();more.hidden=!open;moreButton.setAttribute('aria-expanded',String(open));layout();});
  const backToMore=()=>{tagForm.hidden=true;tagError.textContent='';more.hidden=false;moreButton.setAttribute('aria-expanded','true');moreButton.focus({preventScroll:true});layout();};
  tagForm.querySelector('[data-tag-cancel]').addEventListener('click',backToMore);
  tagForm.addEventListener('compositionstart',()=>tagComposing=true);tagForm.addEventListener('compositionend',()=>tagComposing=false);
  tagForm.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();if(!tagComposing)applySymbol('tag',{tagName:tagInput.value});});
  const begin=()=>{composing=true;cancelPending();hide();},end=()=>{composing=false;settle();};
  const down=event=>{
    if(toolbar.contains(event.target))return;
    if(fieldAllowed(event.target)){touchSelection=event.pointerType==='touch'||event.pointerType==='pen';pointers.add(event.pointerId);dismissed=null;cancelPending();hide();}
    else {cancelPending();hide();}
  };
  const up=event=>{if(pointers.delete(event.pointerId))settle();};
  const touchStart=event=>{if(editor.contains(event.target)){touchSelection=true;touches=event.touches.length;cancelPending();hide();}};
  const touchEnd=event=>{if(touches){touches=event.touches.length;if(!touches)settle();}};
  const keydown=event=>{
    if(event.key==='Escape'&&!toolbar.hidden){
      event.preventDefault();event.stopPropagation();
      if(!tagForm.hidden){backToMore();return;}
      if(!more.hidden){resetMenu();moreButton.focus({preventScroll:true});layout();return;}
      const saved=dismiss();(saved?.field?.isConnected?saved.field:area).focus({preventScroll:true});
    }else if(event.altKey&&event.key==='F10'&&!toolbar.hidden){event.preventDefault();row.querySelector('button').focus();}
    else if(fieldAllowed(event.target)&&(event.key==='Shift'||event.shiftKey&&/^(Arrow|Home|End|Page)/.test(event.key)||(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a')){
      keys.add(event.key);dismissed=null;cancelPending();hide();
    }
  };
  const keyup=event=>{const had=keys.delete(event.key);if(had||editor.contains(event.target))settle();};
  const blur=()=>{pointers.clear();keys.clear();touches=0;cancelPending();hide();};
  const listeners=[[doc,'selectionchange',settle],[editor,'select',settle,true],[editor,'input',settle],[editor,'compositionstart',begin],[editor,'compositionend',end],[editor,'pcm-random-mode',settle],[doc,'focusin',settle],[doc,'pointerdown',down,true],[doc,'pointerup',up,true],[doc,'pointercancel',up,true],[doc,'touchstart',touchStart,{passive:true,capture:true}],[doc,'touchend',touchEnd,true],[doc,'touchcancel',touchEnd,true],[doc,'keyup',keyup,true],[doc,'scroll',layout,true],[parent,'keydown',keydown,true],[win,'blur',blur],[win,'resize',layout],[win.visualViewport,'resize',layout],[win.visualViewport,'scroll',layout]];
  for(const [target,event,fn,options] of listeners)target?.addEventListener(event,fn,options);
  const offEnvironment=onEnvironment?.(layout);
  return {dispose(){disposed=true;cancelPending();offEnvironment?.();for(const [target,event,fn,options] of listeners)target?.removeEventListener(event,fn,options);hide();toolbar.remove();}};
}
