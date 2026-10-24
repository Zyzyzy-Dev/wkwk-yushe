// 快照推理设置表单：当前设置只读、创建页独立编辑，模板操作通过宿主执行。
export function createSnapshotReasoningForm({value,templates=[],readOnly=false,host,contextKey,run,prompt,confirm,isDisposed=()=>false,onChange=()=>{}}){
  const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const element=node('div','pcm-snapshot-reasoning-form');
  const flags=node('div','pcm-snapshot-reasoning-flags');
  const field=(text,input,cls='')=>{const row=node('label','pcm-snapshot-reasoning-field '+cls);row.append(node('span','',text),input);return row;};
  const controls={};
  for(const [key,text] of [['auto_parse','自动解析'],['auto_expand','自动展开'],['show_hidden','显示隐藏内容'],['add_to_prompts','添加到提示词']]){
    const input=node('input');input.type='checkbox';input.checked=value[key];input.setAttribute('aria-label',text);
    const label=node('label','pcm-snapshot-reasoning-flag');label.append(input,node('span','',text));flags.append(label);controls[key]=input;
    input.addEventListener('change',()=>{value[key]=input.checked;onChange();});
  }
  const max=node('input');max.type='number';max.min='0';max.max='999';max.step='1';max.required=true;max.value=value.max_additions;max.setAttribute('aria-label','最大值');controls.max_additions=max;
  max.addEventListener('input',()=>{value.max_additions=max.valueAsNumber;onChange();});flags.append(field('最大值',max,'pcm-reasoning-maximum'));
  const format=node('div','pcm-snapshot-reasoning-format');format.append(node('strong','','推理内容格式化'));
  const template=node('select');template.setAttribute('aria-label','推理格式模板');controls.name=template;
  const templateRow=node('div','pcm-snapshot-reasoning-template');templateRow.append(field('模板',template));
  const fields=node('div','pcm-snapshot-reasoning-texts');
  for(const [key,text] of [['prefix','前缀'],['suffix','后缀'],['separator','分隔符']]){
    const input=node('textarea');input.rows=1;input.spellcheck=false;input.value=value[key];input.setAttribute('aria-label',text);controls[key]=input;
    // Keep exact CRLF in untouched values; only actual edits replace the saved text.
    input.addEventListener('input',()=>{value[key]=input.value;onChange();});fields.append(field(text,input,'pcm-reasoning-'+key));
  }
  let records=templates.map(row=>({...row}));
  function refreshOptions(){
    template.replaceChildren();
    const names=[...new Set([value.name,...records.map(row=>row.name)])];
    for(const name of names){const option=node('option','',name||'自定义格式');option.value=name;template.append(option);}
    template.value=value.name;
    for(const button of templateRow.querySelectorAll('button')){
      const unavailable=button.dataset.action!=='saveAs'&&!records.some(row=>row.name===value.name);
      button.dataset.unavailable=String(unavailable);button.disabled=unavailable;
    }
  }
  template.addEventListener('change',()=>{
    const selected=records.find(row=>row.name===template.value);if(!selected)return;
    Object.assign(value,selected);for(const key of ['prefix','suffix','separator'])controls[key].value=value[key];refreshOptions();onChange();
  });
  if(!readOnly){
    const paths={overwrite:'M5 3h12l4 4v14H3V3h2 M7 3v6h10V3 M7 21v-8h10v8',saveAs:'M14 2H4v20h16V8l-6-6Z M14 2v6h6 M8 15h8 M12 11v8',delete:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',rename:'m14 5 5 5 M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z'};
    const actions=node('div','pcm-snapshot-reasoning-template-actions');
    for(const [action,text] of [['overwrite','覆盖'],['saveAs','另存为'],['rename','重命名'],['delete','删除']]){
      const button=node('button','pcm-snapshot-icon');button.type='button';button.dataset.action=action;button.title=text+'推理模板';button.setAttribute('aria-label',text+'推理模板');
      button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[action]+'"/></svg>';
      button.addEventListener('click',()=>run(async()=>{
        const expected=records.find(row=>row.name===value.name);
        let name=value.name;
        if(action==='saveAs'||action==='rename'){name=await prompt(action==='rename'?'推理模板新名称':'另存为推理模板',action==='saveAs'?value.name+' 副本':value.name);if(name===null||isDisposed())return;name=name.trim();}
        else if(!await confirm((action==='delete'?'删除':'覆盖')+'酒馆推理模板「'+value.name+'」？此操作会修改酒馆模板库，已保存快照中的格式副本会保留。')||isDisposed())return;
        const result=await host.request('snapshot-reasoning-template',{action,name,expected,template:{name:value.name,prefix:value.prefix,suffix:value.suffix,separator:value.separator},contextKey});
        if(isDisposed())return;
        records=result.templates;
        if(result.selectedName)value.name=result.selectedName;
        refreshOptions();onChange();
      }));actions.append(button);
    }
    templateRow.append(actions);
  }
  refreshOptions();format.append(templateRow,fields);element.append(flags,format);
  if(!readOnly)element.append(node('small','pcm-snapshot-notice','开关和格式先保存在快照草稿中；模板图标操作会直接修改酒馆模板库。'));
  else for(const control of Object.values(controls)){control.disabled=true;control.dataset.unavailable='true';}
  return {element};
}
