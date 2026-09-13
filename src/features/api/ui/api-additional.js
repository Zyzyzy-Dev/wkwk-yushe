// API 附加参数草稿弹窗：保留原生 YAML 文本，确认仅更新外层方案草稿。
import { normalizeApiAdditional } from '../api-manager.js';
export function editApiAdditional({parent,value}) {
  const dialog=document.createElement('dialog');dialog.className='pcm-api-modal';dialog.setAttribute('aria-label','附加参数');
  const form=document.createElement('form');form.className='pcm-api-editor';
  const title=document.createElement('h3');title.textContent='附加参数';form.append(title);
  const values=normalizeApiAdditional(value || {}), inputs={};
  for(const [key,label,hint] of [['custom_include_body','包括主体参数','YAML 对象，例如：\ntop_k: 20'],['custom_exclude_body','排除主体参数','YAML 数组，例如：\n- frequency_penalty'],['custom_include_headers','包含请求标头','YAML 对象，例如：\nX-Custom-Header: value']]) {
    const wrap=document.createElement('label');wrap.className='pcm-api-field';
    const caption=document.createElement('span');caption.textContent=label;
    const input=document.createElement('textarea');input.rows=4;input.value=values[key];input.placeholder=hint;input.maxLength=100000;input.setAttribute('aria-label',label);input.spellcheck=false;
    wrap.append(caption,input);form.append(wrap);inputs[key]=input;
  }
  const hint=document.createElement('small');hint.textContent='确认后点击「保存方案」生效；留空表示切换时清空对应参数。';form.append(hint);
  const actions=document.createElement('div');actions.className='pcm-snapshot-actions';form.append(actions);dialog.append(form);parent.append(dialog);
  return new Promise(resolve=>{
    const close=value=>{dialog.close();dialog.remove();resolve(value);};
    const save=document.createElement('button');save.type='submit';save.textContent='确定';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=()=>close(null);actions.append(save,cancel);
    form.onsubmit=event=>{event.preventDefault();close(normalizeApiAdditional(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value]))));};
    dialog.addEventListener('cancel',event=>{event.preventDefault();close(null);});dialog.showModal();
  });
}
