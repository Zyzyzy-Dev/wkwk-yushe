// 世界书正文双栏对比：复用预设差异算法，以同步背景高亮支持直接编辑，仅确认后更新草稿。
import {diffLines,buildRows} from '../core.js';

export function openWorldbookContentCompare({parent,items,onSave,onClose}) {
  const node=(tag,cls='',text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const dialog=node('dialog','pcm-wb-modal pcm-wb-compare-modal');dialog.setAttribute('aria-label','世界书正文对比');
  const head=node('header','pcm-wb-modal-head');head.append(node('strong','','世界书正文对比'));
  const close=node('button','','取消');close.type='button';close.addEventListener('click',()=>dialog.close());head.append(close);
  const actions=node('div','pcm-wb-actions'),save=node('button','pcm-wb-primary','确认');save.type='button';actions.append(save);
  const toggle=node('button','pcm-wb-compare-toggle','正文差异');toggle.type='button';let showDiff=true;toggle.setAttribute('aria-pressed','true');actions.append(toggle);
  const columns=node('div','pcm-wb-diff-columns'),editors=[],backdrops=[],initialValues=[];
  const sync=index=>{const area=editors[index],bd=backdrops[index];bd.style.width=area.clientWidth+'px';bd.style.height=area.clientHeight+'px';bd.scrollTop=area.scrollTop;bd.scrollLeft=area.scrollLeft;};
  items.forEach((item,index)=>{
    const column=node('section','pcm-wb-compare-column');column.append(node('h4','',item.title));
    const editor=node('div','pcm-wb-compare-editor');
    const backdrop=node('div','pcm-wb-compare-backdrop');backdrop.setAttribute('aria-hidden','true');
    const input=node('textarea','pcm-wb-compare-input');input.value=item.content;input.spellcheck=false;input.setAttribute('aria-label',index===0?'第一条正文':'第二条正文');
    editors.push(input);backdrops.push(backdrop);initialValues.push(input.value);
    editor.append(backdrop,input);column.append(editor);columns.append(column);
    input.addEventListener('input',render);input.addEventListener('scroll',()=>sync(index));
  });
  function render(){
    const rows=showDiff?buildRows(diffLines(editors[0].value,editors[1].value)):[];
    backdrops.forEach((bd,index)=>{
      bd.replaceChildren();
      for(const row of rows){
        if(index===0&&row.t==='+'||index===1&&row.t==='-')continue;
        const line=node('span','pcm-wb-compare-line'+(row.t==='-'?' is-removed':row.t==='+'?' is-added':''));
        for(const seg of row.segs){
          if(index===0&&seg.t==='+'||index===1&&seg.t==='-')continue;
          line.append(node('span',seg.t==='-'?'pcm-wb-removed':seg.t==='+'?'pcm-wb-added':'',seg.text));
        }
        bd.append(line,document.createTextNode('\n'));
      }
      sync(index);
    });
  }
  toggle.addEventListener('click',()=>{showDiff=!showDiff;toggle.setAttribute('aria-pressed',String(showDiff));render();});
  const error=node('p','pcm-wb-error');error.setAttribute('role','status');
  save.addEventListener('click',()=>{try{onSave(editors.map((el,index)=>el.value===initialValues[index]?items[index].content:el.value));dialog.close();}catch(e){error.textContent=e.message;}});
  const observer=new ResizeObserver(()=>editors.forEach((_,index)=>sync(index)));
  dialog.addEventListener('click',e=>e.stopPropagation());dialog.addEventListener('keydown',e=>e.stopPropagation());
  dialog.addEventListener('close',()=>{observer.disconnect();dialog.remove();onClose?.();},{once:true});
  dialog.append(head,actions,columns,error);parent.append(dialog);dialog.showModal();editors.forEach(area=>observer.observe(area));render();return dialog;
}
