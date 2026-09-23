// 条目详情引用变量选择器：读取当前侧及未保存正文，在保留的光标位置插入，不直接保存条目。
import {unreferencedVariableChoices} from '../variables.js';

export function installVariableReferencePicker(detail, {getPreset, isInjected}) {
  const areas=[...detail.querySelectorAll('textarea[name=content]')];
  if(!areas.length)return;
  const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const button=(text,action)=>{const el=node('button',text);el.type='button';el.className='menu_button';el.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();action();});return el;};
  for(const editor of detail.querySelectorAll('.pcm-version-editor')) {
  const area=editor.querySelector('textarea[name=content]');
  const launch=button('插入引用变量',()=>{
    detail.querySelector('[data-variable-reference-picker]')?.remove();
    const side=area.form.dataset.side,preset=getPreset(side);
    const original=area?.value,start=area?.selectionStart,end=area?.selectionEnd;
    const layer=node('section');layer.className='pcm-picker open';layer.dataset.variableReferencePicker='';layer.setAttribute('role','dialog');layer.setAttribute('aria-label','插入引用变量');
    const box=node('div');box.className='pcm-picker-panel';
    const head=node('header');head.className='pcm-picker-head';
    const close=()=>{layer.remove();if(area?.isConnected){area.focus({preventScroll:true});}};
    head.append(node('h3','插入引用变量'+(side?' · '+(side==='old'?'旧版':'新版'):'')),button('取消',close));box.append(head);
    const body=node('div');body.className='pcm-variable-body';box.append(body);layer.append(box);detail.append(layer);
    layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
    const livePrompts=()=>{
      const edits=new Map(areas.filter(a=>a.form.dataset.side===side).map(a=>[a.form.dataset.id,a.value]));
      return (getPreset(side)?.prompts||[]).map(p=>edits.has(p.identifier)?{...p,content:edits.get(p.identifier)}:p);
    };
    const choices=unreferencedVariableChoices(livePrompts(),id=>id===area.form.dataset.id||isInjected(side,id));
    const search=node('input');search.type='search';search.placeholder='搜索未引用变量';search.setAttribute('aria-label','搜索未引用变量');body.append(search);
    const status=node('p');status.setAttribute('role','status');body.append(status);
    const list=node('div');list.className='pcm-variable-reference-options';body.append(list);
    const draw=()=>{
      list.replaceChildren();const visible=choices.filter(item=>item.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
      status.textContent=choices.length?'选择一个变量，插入后点击“保存条目”保存。':'当前没有未引用的变量。';
      if(choices.length&&!visible.length)status.textContent='没有匹配的变量。';
      for(const item of visible)list.append(button(item.macro,()=>{
        if(!area.isConnected||getPreset(side)!==preset||area.value!==original){status.textContent='条目已变化，请关闭后重新选择插入位置。';return;}
        if(!unreferencedVariableChoices(livePrompts(),id=>id===area.form.dataset.id||isInjected(side,id)).some(v=>v.key===item.key)){status.textContent='变量状态已变化，请关闭后重新打开。';return;}
        area.setRangeText(item.macro,start,end,'end');area.dispatchEvent(new Event('input',{bubbles:true}));close();
      }));
    };
    search.addEventListener('input',draw);draw();search.focus();
  });
  launch.disabled=!area;
  if(!area)launch.title='此版本没有该条目';
  const heading=editor.querySelector('h4'),bar=node('div');bar.className='pcm-variable-entry-heading';
  heading.before(bar);bar.append(heading,launch);
  }
}
