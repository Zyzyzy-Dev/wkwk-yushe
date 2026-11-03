// 保存预设前处理未提交条目：默认聚焦检查，关闭或 Escape 取消，仅返回用户选择。
export function choosePresetSave({parent}){
  if(!parent?.isConnected||parent.querySelector('.pcm-save-drafts-modal'))return Promise.resolve(null);
  const doc=parent.ownerDocument,previousFocus=doc.activeElement;
  const node=(tag,className,text)=>{const element=doc.createElement(tag);element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const modal=node('dialog','pcm-modal pcm-save-drafts-modal');
  modal.setAttribute('aria-label','保存预设');
  const box=node('div','pcm-modal-box'),header=node('div','pcm-save-drafts-header');
  const message=node('div','pcm-modal-msg','您的预设条目中还有尚未提交的编辑，你希望怎么处理？');
  message.id='pcm-save-drafts-message';modal.setAttribute('aria-describedby',message.id);
  const close=node('button','menu_button pcm-save-drafts-close','×');
  close.type='button';close.dataset.presetSaveChoice='cancel';close.setAttribute('aria-label','关闭');close.title='关闭';
  header.append(message,close);
  const actions=node('div','pcm-modal-row');
  for(const [choice,label] of [['check','检查预设条目'],['save','直接保存']]){
    const button=node('button','menu_button'+(choice==='save'?' pcm-primary':''),label);
    button.type='button';button.dataset.presetSaveChoice=choice;actions.append(button);
  }
  box.append(header,actions);modal.append(box);parent.append(modal);
  return new Promise(resolve=>{
    let settled=false;
    const finish=choice=>{
      if(settled)return;settled=true;
      if(modal.open)modal.close();modal.remove();parent.removeEventListener('close',parentClosed);
      if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
      resolve(choice);
    };
    const parentClosed=()=>finish(null);
    parent.addEventListener('close',parentClosed);
    modal.addEventListener('click',event=>{
      const button=event.target.closest('[data-preset-save-choice]');if(!button)return;
      event.stopPropagation();finish(button.dataset.presetSaveChoice==='cancel'?null:button.dataset.presetSaveChoice);
    });
    modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(null);}});
    modal.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();finish(null);});
    modal.addEventListener('close',()=>finish(null),{once:true});
    if(typeof modal.showModal==='function')modal.showModal();else modal.setAttribute('open','');
    actions.querySelector('[data-preset-save-choice=check]').focus({preventScroll:true});
  });
}
