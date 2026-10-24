// 自动解析绑定弹窗：编辑快照自己的格式副本，不直接改变酒馆当前设置或模板文件。
export async function chooseSnapshotReasoning({host,snapshotId,parent,signal}) {
  if (signal?.aborted) return false;
  const model = await host.request('snapshot-reasoning-read', {id:snapshotId});
  if (signal?.aborted || !parent.isConnected) return false;
  const node = (tag,text) => {const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const dialog=node('dialog');dialog.className='pcm-snapshot-reasoning-dialog';dialog.setAttribute('aria-label','自动解析设置');
  const form=node('form'),heading=node('h3','自动解析设置'),hint=node('p','保存后，手动切换或进入绑定的聊天时会应用这份设置。未绑定的快照保持酒馆当前设置。');
  const automatic=node('input');automatic.type='checkbox';
  const check=node('label');check.className='pcm-reasoning-check';check.append(automatic,node('span','自动解析'));
  const template=node('select');template.setAttribute('aria-label','推理格式模板');
  const custom=node('option','自定义／保存的格式');custom.value='';template.append(custom);
  for(let i=0;i<model.templates.length;i++){const option=node('option',model.templates[i].name);option.value=String(i);template.append(option);}
  const field=(label,control)=>{const wrap=node('label');wrap.className='pcm-reasoning-field';wrap.append(node('span',label),control);return wrap;};
  const fields={};for(const [key,label] of [['prefix','前缀'],['suffix','后缀'],['separator','分隔符']]){const input=node('textarea');input.rows=2;input.spellcheck=false;input.setAttribute('aria-label',label);fields[key]=input;}
  let name='',busy=false,finished=false,originalFields={};
  const fill=value=>{
    name=value.name;automatic.checked=value.auto_parse;
    originalFields=Object.fromEntries(Object.keys(fields).map(key=>[key,value[key]]));
    for(const key of Object.keys(fields))fields[key].value=value[key];
    const index=model.templates.findIndex(item=>item.name===name&&Object.keys(fields).every(key=>item[key]===value[key]));
    template.value=index<0?'':String(index);
  };
  fill(model.binding || model.current);
  template.addEventListener('change',()=>{const value=model.templates[Number(template.value)];if(template.value!==''&&value)fill({...value,auto_parse:automatic.checked});});
  for(const input of Object.values(fields))input.addEventListener('input',()=>{template.value='';});
  const status=node('p');status.className='pcm-reasoning-status';status.setAttribute('role','status');
  const actions=node('div');actions.className='pcm-reasoning-actions';
  form.append(heading,hint,check,field('推理格式模板',template),field('前缀',fields.prefix),field('后缀',fields.suffix),field('分隔符',fields.separator),node('small','只绑定自动解析开关与格式；自动展开、显示隐藏内容等选项保持当前。空格与换行会原样保存。'),status,actions);dialog.append(form);parent.append(dialog);
  return new Promise(resolve=>{
    const prior=document.activeElement;
    const close=value=>{if(finished)return;finished=true;signal?.removeEventListener('abort',abort);dialog.close();dialog.remove();if(prior?.isConnected)prior.focus({preventScroll:true});resolve(value);};
    const abort=()=>close(false);signal?.addEventListener('abort',abort,{once:true});
    const setBusy=value=>{busy=value;dialog.setAttribute('aria-busy',String(value));for(const control of form.querySelectorAll('button,input,select,textarea'))control.disabled=value;};
    const save=async cancel=>{
      if(busy||finished)return;
      // Textareas normalize CRLF in their value; preserve untouched native text.
      const config=cancel?null:{version:1,auto_parse:automatic.checked,name,...Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value===originalFields[key].replace(/\r\n?/g,'\n')?originalFields[key]:input.value]))};
      setBusy(true);status.textContent='正在保存…';
      try{await host.request('snapshot-reasoning-save',{id:snapshotId,config});if(!finished)close(true);}
      catch(error){if(!finished){status.textContent=error.message;setBusy(false);}}
    };
    const action=(label,callback)=>{const b=node('button',label);b.type='button';b.addEventListener('click',callback);actions.append(b);return b;};
    action('使用酒馆当前设置',()=>fill(model.current));
    action('保存绑定',()=>save(false)).className='pcm-snapshot-primary';
    if(model.binding)action('解除绑定',()=>save(true));
    action('关闭',()=>close(false));
    form.addEventListener('submit',event=>{event.preventDefault();void save(false);});
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)close(false);});
    if(signal?.aborted){close(false);return;}
    dialog.showModal();automatic.focus();
  });
}
