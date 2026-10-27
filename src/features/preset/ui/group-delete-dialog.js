// 删除预设分组三选确认：取消为初始焦点，按 Escape 只关闭当前确认框。
export function chooseGroupRemoval({parent,groupName,count}){
  if(!parent?.isConnected||parent.querySelector('.pcm-group-delete-modal'))return Promise.resolve(null);
  const doc=parent.ownerDocument,previousFocus=doc.activeElement;
  const node=(tag,className,text)=>{const e=doc.createElement(tag);e.className=className;if(text!==undefined)e.textContent=text;return e;};
  const modal=node('dialog','pcm-modal pcm-group-delete-modal');
  modal.setAttribute('aria-label','你需要怎么处理此分组？');
  const box=node('div','pcm-modal-box'),title=node('div','pcm-modal-msg','你需要怎么处理此分组？');
  const details=node('div','pcm-group-delete-description',`${groupName||'未命名分组'} · ${count} 条\n包含被搜索隐藏、折叠或未启用的组内条目。操作后可撤回，保存预设后才写回酒馆。`);
  const actions=node('div','pcm-modal-row');
  for(const [choice,label] of [['cancel','取消'],['ungroup','仅解除分组'],['delete','彻底删除分组及组中条目']]){
    const b=node('button','menu_button'+(choice==='delete'?' pcm-group-delete-danger':''),label);
    b.type='button';b.dataset.groupDeleteChoice=choice;actions.append(b);
  }
  box.append(title,details,actions);modal.append(box);parent.append(modal);
  return new Promise(resolve=>{
    let settled=false;
    const finish=choice=>{if(settled)return;settled=true;if(modal.open)modal.close();modal.remove();parent.removeEventListener('close',parentClosed);if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});resolve(choice);};
    const parentClosed=()=>finish(null);
    parent.addEventListener('close',parentClosed);
    modal.addEventListener('click',event=>{const b=event.target.closest('[data-group-delete-choice]');if(!b)return;event.stopPropagation();finish(b.dataset.groupDeleteChoice==='cancel'?null:b.dataset.groupDeleteChoice);});
    modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(null);}});
    modal.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();finish(null);});
    modal.addEventListener('close',()=>finish(null),{once:true});
    if(typeof modal.showModal==='function')modal.showModal();else modal.setAttribute('open','');
    actions.querySelector('[data-group-delete-choice=cancel]').focus({preventScroll:true});
  });
}
