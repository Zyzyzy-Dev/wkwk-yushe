// 世界书条目编辑：独立草稿、原生字段排版与深度角色组合，保留未展示配置。
import {clone} from '../core.js';
import {normalizeWorkbenchBook} from '../worldbook-workbench.js';

export function openWorkbenchEntryEditor({parent, entry, title, onSave}) {
  const node=(tag,cls='',text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const dialog=node('dialog','pcm-wb-modal pcm-wb-entry-modal');dialog.setAttribute('aria-label','编辑世界书条目');
  const form=node('form','pcm-wb-entry-form');form.method='dialog';
  const head=node('header','pcm-wb-modal-head');head.append(node('strong','',title));
  const close=node('button','','取消');close.type='button';close.addEventListener('click',()=>dialog.close());head.append(close);
  const fields=node('div','pcm-wb-entry-fields'),error=node('p','pcm-wb-error');error.setAttribute('role','status');
  const draft=clone(entry),bindings=[];
  function section(cls){const el=node('div',cls);fields.append(el);return el;}
  const basic=section('pcm-wb-entry-basic'),keywords=section('pcm-wb-entry-keywords'),body=section('pcm-wb-entry-body'),settings=section('pcm-wb-entry-settings');
  function field(parent,text,key,{type='text',options,rows,defaultValue='',min,max}={}) {
    const label=node('label','pcm-wb-field');label.append(node('span','',text));
    const input=node(options?'select':rows?'textarea':'input');input.setAttribute('aria-label',text);
    if(options)for(const [value,text] of options){const option=node('option','',text);option.value=String(value);input.append(option);}
    else if(rows){input.rows=rows;input.spellcheck=false;}else input.type=type;
    if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);if(type==='number')input.step='any';
    if(type==='checkbox'){input.classList.add('pcm-native-switch');label.classList.add('pcm-wb-field-toggle');}
    const value=draft[key]??defaultValue;if(type==='checkbox')input.checked=Boolean(value);else input.value=Array.isArray(value)?value.join(', '):String(value);
    const initialInputValue=input.value;
    // Read controls only on save: typing does not normalize untouched optional metadata.
    bindings.push(()=>{if(type==='checkbox'){if(input.checked!==Boolean(value))draft[key]=input.checked;}else if(input.value!==initialInputValue){draft[key]=type==='number'||options?Number(input.value):key==='key'||key==='keysecondary'?input.value.split(/[,，]/).map(s=>s.trim()).filter(Boolean):input.value;}});
    label.append(input);parent.append(label);return {input,label};
  }
  field(basic,'标题（备忘）','comment').label.classList.add('pcm-wb-entry-title');
  const trigger=node('label','pcm-wb-field');trigger.append(node('span','','触发策略'));const triggerInput=node('select');triggerInput.setAttribute('aria-label','触发策略');
  for(const [value,text] of [['constant','🔵 常驻'],['keyword','🟢 关键词'],['vector','🟣 向量']]){const option=node('option','',text);option.value=value;triggerInput.append(option);}trigger.append(triggerInput);basic.append(trigger);
  triggerInput.value=draft.constant?'constant':draft.vectorized?'vector':'keyword';
  triggerInput.addEventListener('change',()=>{draft.constant=triggerInput.value==='constant';draft.vectorized=triggerInput.value==='vector';});
  const position=node('label','pcm-wb-field pcm-wb-entry-position');position.append(node('span','','插入位置'));const positionInput=node('select');positionInput.setAttribute('aria-label','插入位置');
  for(const [value,text] of [['0','角色定义前（↑Char）'],['1','角色定义后（↓Char）'],['5','示例消息前（↑EM）'],['6','示例消息后（↓EM）'],['2','作者注释前（↑AN）'],['3','作者注释后（↓AN）'],['4:0','[系统⚙] 插入深度 @D'],['4:1','[用户👤] 插入深度 @D'],['4:2','[AI🤖] 插入深度 @D'],['7','➡️ 锚点']]){const option=node('option','',text);option.value=value;positionInput.append(option);}
  positionInput.value=Number(draft.position??0)===4?'4:'+Number(draft.role??0):String(draft.position??0);position.append(positionInput);basic.append(position);
  const depth=field(basic,'深度','depth',{type:'number',defaultValue:4,min:0});field(basic,'顺序','order',{type:'number',defaultValue:100});field(basic,'触发频率 %','probability',{type:'number',defaultValue:100,min:0,max:100});
  const syncPosition=()=>{depth.input.disabled=Number(draft.position??0)!==4;depth.input.dataset.unavailable=String(depth.input.disabled);depth.input.value=depth.input.disabled?'':String(draft.depth??4);};
  positionInput.addEventListener('change',()=>{const [position,role]=positionInput.value.split(':').map(Number);draft.position=position;if(position===4)draft.role=role;syncPosition();});syncPosition();
  field(keywords,'主要关键字','key',{defaultValue:[]});
  field(keywords,'逻辑','selectiveLogic',{options:[[0,'任一匹配'],[1,'非全部匹配'],[2,'全不匹配'],[3,'全部匹配']],defaultValue:0});
  field(keywords,'可选过滤器','keysecondary',{defaultValue:[]});
  field(body,'内容','content',{rows:13});
  const actions=node('div','pcm-wb-actions');const save=node('button','pcm-wb-primary','确认');save.type='submit';actions.append(save);
  form.addEventListener('submit',e=>{e.preventDefault();if(!form.reportValidity())return;try{for(const bind of bindings)bind();normalizeWorkbenchBook({entries:{[entry.uid]:draft}});onSave(clone(draft));dialog.close();}catch(e){error.textContent=e.message;}});
  dialog.addEventListener('click',e=>e.stopPropagation());dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  form.append(head,fields,error,actions);dialog.append(form);parent.append(dialog);dialog.showModal();return dialog;
}
