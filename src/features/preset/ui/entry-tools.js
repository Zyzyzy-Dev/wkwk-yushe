// 预设条目工具栏：复用原生正文与引用入口，安装符号检查、random 分块模式与正文撤销，并集中释放监听。
import {createContentEditorAdapter} from './content-editor-adapter.js';
import {installRandomEditor} from './random-editor.js';

// history：{get(side,id),set(side,id,state)}，按条目保存正文撤销记录；undoSlot 为放置「撤销」按钮的容器。
export function installEntryTools(detail,{onCheckSymbols,onError=()=>{},history,undoSlot}) {
  const disposers=[],adapters=[];let last=null;
  const doc=detail.ownerDocument;
  const undo=doc.createElement('button');undo.type='button';undo.className='menu_button pcm-content-undo';undo.textContent='撤销';
  undo.title='撤销此条目正文的上一次修改（只影响当前条目，包括随机编辑）';undo.dataset.contentUndo='';
  const refreshUndo=()=>{undo.disabled=!adapters.some(a=>a.canUndo());};
  undo.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();
    const target=last?.canUndo()?last:adapters.find(a=>a.canUndo());if(target)target.undo();refreshUndo();});
  for(const editor of detail.querySelectorAll('.pcm-version-editor')){
    const area=editor.querySelector('textarea[name=content]'),heading=editor.querySelector('.pcm-variable-entry-heading');
    if(!area||!heading||heading.querySelector('.pcm-entry-tools'))continue;
    const {side,id}=area.form.dataset,bar=doc.createElement('div');bar.className='pcm-entry-tools';
    const adapter=createContentEditorAdapter({area,initial:history?.get(side,id),onState:state=>{history?.set(side,id,state);last=adapter;refreshUndo();}});
    adapters.push(adapter);
    const random=installRandomEditor({container:area.closest('.pcm-inline-content'),adapter,onError});
    const make=(text,fn)=>{const b=doc.createElement('button');b.type='button';b.className='menu_button';b.textContent=text;b.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();try{fn();}catch(error){onError(error.message);}});return b;};
    const check=make('符号检查',()=>onCheckSymbols(side,id));check.dataset.entryCheck='';
    const toggle=make('随机编辑',()=>random.setEnabled(!random.isEnabled()));toggle.dataset.randomToggle='';toggle.setAttribute('aria-label','随机编辑');toggle.setAttribute('aria-pressed','false');
    const mode=()=>{const enabled=random.isEnabled();toggle.textContent=enabled?'随机编辑 ×':'随机编辑';toggle.setAttribute('aria-pressed',String(enabled));toggle.classList.toggle('pcm-primary',enabled);toggle.classList.toggle('pcm-random-active',enabled);editor.classList.toggle('pcm-random-mode',enabled);};
    area.addEventListener('pcm-random-mode',mode);
    const saved=()=>adapter.clearHistory();area.form.addEventListener('submit',saved);
    const reference=heading.querySelector('[data-variable-reference-launch]');bar.append(check,toggle);if(reference)bar.append(reference);heading.append(bar);
    disposers.push(()=>{area.removeEventListener('pcm-random-mode',mode);area.form.removeEventListener('submit',saved);random.dispose();adapter.dispose();});
  }
  if(adapters.length&&undoSlot){undoSlot.prepend(undo);refreshUndo();}
  return {dispose(){for(const dispose of disposers.splice(0))dispose();undo.remove();}};
}
