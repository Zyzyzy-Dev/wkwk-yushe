// random 原生 textarea 分块视图；完整源码输入框仍为唯一表单字段。选中普通正文时浮出「转为随机」。
import {createRandomEditorState,partitionRandomSource,updateRandomBlock} from '../random-editor-state.js';
import {scanRandomMacros,planRandomAppend,planRandomWrap} from '../random-macros.js';
// 用同样式的隐藏镜像元素测出 textarea 内某个字符的位置（相对 textarea 内容区）。
function caretPoint(field,index){
 const doc=field.ownerDocument,cs=doc.defaultView.getComputedStyle(field),mirror=doc.createElement('div'),mark=doc.createElement('span');
 for(const prop of ['boxSizing','width','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','tabSize','textIndent','textTransform'])mirror.style[prop]=cs[prop];
 Object.assign(mirror.style,{position:'absolute',visibility:'hidden',top:'0',left:'-9999px',whiteSpace:'pre-wrap',overflowWrap:'break-word',wordBreak:cs.wordBreak,borderStyle:'solid'});
 mirror.textContent=field.value.slice(0,index);mark.textContent='​';mirror.append(mark);doc.body.append(mirror);
 const point={top:mark.offsetTop,left:mark.offsetLeft,height:mark.offsetHeight||parseFloat(cs.lineHeight)||18};mirror.remove();return point;
}
export function installRandomEditor({container,adapter,scan=scanRandomMacros,append=planRandomAppend,wrapSelection=planRandomWrap,onError=()=>{}}) {
 const area=adapter.area, doc=area.ownerDocument, wrap=area.closest('.pcm-editwrap') || area;
 const root=doc.createElement('div'); root.className='pcm-random-editor'; root.hidden=true;
 const hint=doc.createElement('p');hint.className='pcm-random-hint';hint.textContent='选中普通正文可转为随机；跨块修改请退出随机编辑。';
 const body=doc.createElement('div');body.className='pcm-random-body';
 const float=doc.createElement('button');float.type='button';float.className='menu_button pcm-primary pcm-random-float';float.textContent='🎲 转为随机';float.hidden=true;float.dataset.randomWrap='';
 root.append(hint,body,float);container.append(root);
 let enabled=false,state=createRandomEditorState(adapter.getText(),scan),detach=null,composing=false,active=null,scroll=0,originalHidden=wrap.hidden;
 const selection=()=>active&&active.isConnected?{start:Number(active.dataset.start)+active.selectionStart,end:Number(active.dataset.start)+active.selectionEnd}:state.selection;
 const fit=field=>{field.style.height='auto';field.style.height=field.scrollHeight+2+'px';};
 // 只有普通正文块里的非空选区才显示浮动按钮，放在选区末尾的下一行。
 function placeFloat(){
  const field=active;
  if(!enabled||composing||!field?.isConnected||doc.activeElement!==field||field.closest('.pcm-random-block-random')||field.selectionStart===field.selectionEnd||!field.value.slice(field.selectionStart,field.selectionEnd).trim()){float.hidden=true;return;}
  const point=caretPoint(field,field.selectionEnd);float.hidden=false;
  const top=field.offsetTop+point.top+point.height-field.scrollTop+4,max=Math.max(0,body.clientWidth-float.offsetWidth);
  float.style.top=Math.min(top,field.offsetTop+field.offsetHeight+4)+'px';float.style.left=Math.max(0,Math.min(field.offsetLeft+point.left-float.offsetWidth/2,max))+'px';
 }
 float.addEventListener('pointerdown',e=>e.preventDefault());float.addEventListener('mousedown',e=>e.preventDefault());
 float.addEventListener('click',()=>{
  try{const edit=wrapSelection(adapter.getText(),selection());adapter.replace(edit);const s=adapter.getSelection();focusRange(s.start,s.end);}
  catch(error){onError(error.message);}
  float.hidden=true;
 });
 const selectionChange=()=>{if(enabled&&body.contains(doc.activeElement))placeFloat();};
 doc.addEventListener('selectionchange',selectionChange);
 function focusRange(start,end){
  const targets=[...body.querySelectorAll('textarea')], field=targets.find(a=>start>=Number(a.dataset.start)&&end<=Number(a.dataset.end));
  state.selection={start,end};
  if(field){active=field;field.focus();field.setSelectionRange(start-Number(field.dataset.start),end-Number(field.dataset.start));}
  else {api.setEnabled(false);adapter.setSelection(start,end);area.focus();}
 }
 function headFor(section,block){
  section.querySelector('.pcm-random-head')?.remove();if(block.type!=='random')return;
  const head=doc.createElement('div');head.className='pcm-random-head';
  const label=doc.createElement('span');label.className='pcm-random-label';
  const count=block.complete?(block.macro?.args?.length||0):0;label.textContent=block.complete?`🎲 随机 · ${count} 个候选`:'🎲 随机 · 宏未闭合';
  const button=doc.createElement('button');button.type='button';button.className='menu_button pcm-random-add';button.textContent='＋ 候选';button.disabled=!block.complete;
  button.title=block.complete?'在末尾增加一个候选':'宏未闭合，请先修改源码';
  button.addEventListener('pointerdown',e=>e.preventDefault());button.addEventListener('mousedown',e=>e.preventDefault());
  button.addEventListener('click',()=>{try{adapter.replace(append(adapter.getText(),state.blocks.find(b=>b.key===section.dataset.key)?.start));const s=adapter.getSelection();focusRange(s.start,s.end);}catch(error){onError(error.message);}});
  head.append(label,button);section.prepend(head);
 }
 function rebuild(text,sel){
  if(composing)return; const hadFocus=body.contains(doc.activeElement);float.hidden=true;
  state={...state,text,blocks:partitionRandomSource(text,scan),selection:sel,pendingReparse:false};
  const previous=new Map([...body.children].map(n=>[n.dataset.key,n])); const fragment=doc.createDocumentFragment();
  for(const block of state.blocks){
   // 空白的首尾正文块不显示，避免随机块之间出现空输入框。
   if(block.type==='text'&&!block.text&&state.blocks.length>1)continue;
   let section=previous.get(block.key);if(!section){section=doc.createElement('section');section.dataset.key=block.key;const field=doc.createElement('textarea');field.spellcheck=false;field.placeholder='在此输入正文';field.setAttribute('aria-label',block.type==='random'?'random 宏源码':'普通正文');section.append(field);
    field.addEventListener('focus',()=>{active=field;});
    field.addEventListener('select',()=>{state.selection=selection();placeFloat();});
    field.addEventListener('keyup',placeFloat);field.addEventListener('pointerup',()=>setTimeout(placeFloat));
    field.addEventListener('scroll',placeFloat);
    field.addEventListener('beforeinput',()=>adapter.captureBeforeInput(selection()));
    field.addEventListener('compositionstart',()=>{adapter.captureBeforeInput(selection());composing=true;float.hidden=true;field._pcmGroup=`ime-${Date.now()}`;});
    field.addEventListener('input',()=>{
     const key=section.dataset.key,b=state.blocks.find(x=>x.key===key);if(!b)return;
     const sel={start:b.start+field.selectionStart,end:b.start+field.selectionEnd};
     state=updateRandomBlock(state,key,field.value,sel,{composing}).state;
     for(const node of body.querySelectorAll('textarea')){const current=state.blocks.find(x=>x.key===node.parentElement.dataset.key);if(current){node.dataset.start=current.start;node.dataset.end=current.end;}}
     const now=Date.now();if(!field._pcmTyping || now-(field._pcmLastInput||0)>750)field._pcmTyping=`typing-${key}-${now}`;field._pcmLastInput=now;adapter.updateText(state.text,sel,{group:field._pcmGroup || field._pcmTyping,deferRender:true});
     fit(field);
     const button=section.querySelector('.pcm-random-add');if(button){const parsed=scan(field.value);const complete=(Array.isArray(parsed)?parsed:parsed.macros || []).some(m=>m.start===0&&m.end===field.value.length&&m.complete!==false);button.disabled=!complete;}
    });
    field.addEventListener('compositionend',()=>{composing=false;field._pcmGroup=null;rebuild(state.text,selection());focusRange(state.selection.start,state.selection.end);});
    field.addEventListener('blur',()=>{float.hidden=true;if(!composing&&state.pendingReparse)rebuild(state.text,selection());});
   }
   section.className=`pcm-random-block pcm-random-block-${block.type}`; const field=section.querySelector('textarea');
   field.dataset.start=block.start;field.dataset.end=block.end;if(field.value!==block.text)field.value=block.text;
   field.rows=1;headFor(section,block);
   fragment.append(section);
  }
  body.replaceChildren(fragment);for(const field of body.querySelectorAll('textarea'))fit(field);if(hadFocus)focusRange(sel.start,sel.end);
 }
 const api={
  setEnabled(value){value=Boolean(value);if(value===enabled)return;
   if(value){state.selection=adapter.getSelection();scroll=area.scrollTop;enabled=true;root.hidden=false;wrap.hidden=true;detach=adapter.attachView({getSelection:selection,focusRange,render:rebuild});focusRange(state.selection.start,state.selection.end);}
   else{const sel=selection();enabled=false;float.hidden=true;detach?.();detach=null;root.hidden=true;wrap.hidden=originalHidden;area.scrollTop=scroll;adapter.setSelection(sel.start,sel.end);area.focus();}
   area.dispatchEvent(new doc.defaultView.CustomEvent('pcm-random-mode',{bubbles:true,detail:{enabled}}));
  },isEnabled:()=>enabled,
  dispose(){if(enabled)api.setEnabled(false);doc.removeEventListener('selectionchange',selectionChange);root.remove();if(area._pcmRandomEditor===api)delete area._pcmRandomEditor;}
 };
 area._pcmRandomEditor=api;return api;
}
