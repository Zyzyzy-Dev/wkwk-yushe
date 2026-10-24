// 预设源码检查结果：只读扫描、过期结果保护与原文定位；不求值或修补宏。
export function openPresetCheckPanel({dialog, title, single=false, getContext, runCheck, navigate, onClose=()=>{}}) {
  const doc=dialog.ownerDocument;
  const node=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,action)=>{const b=node('button','menu_button',text);b.type='button';b.addEventListener('click',action);return b;};
  const element=node('section','pcm-picker open pcm-check-layer');element.dataset.presetCheckPanel='';
  element.setAttribute('role','dialog');element.setAttribute('aria-label',title);
  const box=node('div','pcm-picker-panel pcm-check-panel'),head=node('header','pcm-picker-head');
  const previousFocus=doc.activeElement;
  const close=()=>{dispose();element.remove();onClose();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});};
  const closeButton=button('×',close);closeButton.setAttribute('aria-label','关闭检查');
  head.append(node('h3','',title),closeButton);
  const controls=node('div','pcm-check-controls');
  const generation=node('select');generation.setAttribute('aria-label','检查的生成类型');
  for(const [value,label] of [['normal','正常生成'],['continue','续写'],['impersonate','AI 帮答'],['swipe','备选回复'],['regenerate','重新生成'],['quiet','静默']]){const o=node('option','',label);o.value=value;generation.append(o);}
  const refreshButton=button('重新检查',()=>scan(true));
  if(!single)controls.append(generation);controls.append(refreshButton);
  const status=node('div','pcm-check-status');status.setAttribute('role','status');
  const scope=node('p','pcm-check-note',single?'当前条目：仅检查宏、括号与代码围栏，不检查标签。':'按提示词查看器顺序拼接当前侧已启用条目检查标签：只有独占一行的标签需要闭合，聊天深度条目插在聊天记录位置；角色卡、世界书与聊天内容不计入。');
  const body=node('div','pcm-check-results');
  box.append(head,controls,scope,status,body);element.append(box);dialog.append(element);
  let snapshot=null,result=null,disposed=false,stale=false;
  const ignored=new Set();
  const key=issue=>JSON.stringify([issue.entryId,issue.start,issue.end,issue.code]);
  function markStale(){if(!snapshot||disposed)return;stale=true;status.textContent='正文或配置已变化，请重新检查。';box.classList.add('pcm-check-stale');body.querySelectorAll('button').forEach(b=>b.disabled=true);}
  const same=next=>next.presetIdentity===snapshot?.presetIdentity&&next.revision===snapshot?.revision;
  function fresh(){let now;try{now=getContext(generation.value);}catch{markStale();return false;}if(!same(now)){markStale();return false;}return !stale;}
  function draw(){
    body.replaceChildren();const issues=(result?.issues||[]).filter(i=>!ignored.has(key(i))),errors=issues.filter(i=>i.severity==='error').length;
    status.textContent=`明确错误 ${errors} · 待确认 ${issues.length-errors}`+(ignored.size?` · 本次忽略 ${ignored.size}`:'');
    const reasons=result?.incompleteReasons||[];
    if(result?.coverage==='partial'||reasons.length){const note=node('div','pcm-check-coverage');note.append(node('strong','','部分内容未完全检查'));for(const reason of new Set(reasons))note.append(node('div','',typeof reason==='string'?reason:reason.message||reason.reason||'动态内容无法静态判断'));body.append(note);}
    if(!issues.length)body.append(node('p','pcm-check-note',ignored.size?'剩余检查项未发现问题。':'本次检查未发现明确的源码问题；不代表最终发送内容已完整验证。'));
    for(const issue of issues){
      const entry=snapshot.context?.entries?.find(e=>e.id===issue.entryId);
      const text=entry?.text??'',start=Math.max(0,issue.start||0),end=Math.max(start+1,issue.end||start+1);
      const card=node('article','pcm-check-issue '+(issue.severity==='error'?'pcm-check-error':'pcm-check-review'));
      card.append(node('strong','',(issue.severity==='error'?'错误 · ':'待确认 · ')+issue.message));
      card.append(node('div','pcm-check-location',(issue.entryName||entry?.name||'未命名条目')+' · 第 '+(issue.line||1)+' 行'));
      const excerpt=text.slice(Math.max(0,start-60),Math.min(text.length,end+100));card.append(node('pre','',excerpt));
      if(issue.related){const list=Array.isArray(issue.related)?issue.related:[issue.related];for(const related of list){const e=snapshot.context?.entries?.find(e=>e.id===related.entryId);card.append(node('div','pcm-check-note','关联位置：'+(related.entryName||e?.name||related.entryId)+' · 第 '+(related.line||1)+' 行'));}}
      const actions=node('div','pcm-check-actions');
      actions.append(button('定位原文',()=>{if(!fresh())return;try{navigate(issue,snapshot);close();}catch(error){status.textContent=error.message;markStale();}}));
      if(issue.severity!=='error')actions.append(button('本次忽略',()=>{if(fresh()){ignored.add(key(issue));draw();}}));
      card.append(actions);body.append(card);
    }
  }
  function scan(clear=false){
    if(clear)ignored.clear();
    try{snapshot=getContext(generation.value);result=runCheck(snapshot);stale=false;box.classList.remove('pcm-check-stale');draw();}
    catch(error){snapshot=null;result=null;body.replaceChildren();status.textContent=error.message||'检查失败，请重新打开。';}
  }
  const onChange=event=>{if(!element.contains(event.target))queueMicrotask(()=>{if(!disposed&&snapshot)fresh();});};
  const onKey=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};
  element.addEventListener('keydown',onKey);generation.addEventListener('change',()=>scan(true));
  dialog.addEventListener('input',onChange);dialog.addEventListener('change',onChange);dialog.addEventListener('click',onChange);
  function dispose(){if(disposed)return;disposed=true;dialog.removeEventListener('input',onChange);dialog.removeEventListener('change',onChange);dialog.removeEventListener('click',onChange);}
  scan();closeButton.focus({preventScroll:true});
  return {element,markStale,dispose,close};
}
