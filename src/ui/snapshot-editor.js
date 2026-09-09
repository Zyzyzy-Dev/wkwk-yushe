// 快照草稿编辑页：独立编辑预设/正则分组开关与全局世界书配置，正文只读，保存前不改变宿主。
import {regexGroupState, toggleRegexGroup} from '../snapshot-resources.js';
import {snapshotPresetSections, snapshotScope} from '../snapshot.js';
import {createSnapshotScopePicker} from './snapshot-scope.js';
export function createSnapshotEditor({host, model, existingId, onCancel, onSaved, toast}) {
  const copy=value=>JSON.parse(JSON.stringify(value));
  const draft=copy(model.draft),context=model.context;
  draft.scope=snapshotScope(draft);
  let editor=copy(model.editor||{}),disposed=false,busy=false;
  draft.resources.version=2;
  draft.resources.worlds={global:[...draft.resources.worlds.global]};
  const scopes=['global','preset','character'],scopeNames={global:'全局正则',preset:'预设正则',character:'角色正则'};
  const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const element=node('section','pcm-snapshot-editor');element.setAttribute('aria-label',existingId?'修改快照':'创建快照');
  const status=node('p','pcm-snapshot-status');status.setAttribute('role','status');
  const form=node('div','pcm-snapshot-form');
  const name=node('input');name.type='text';name.maxLength=120;name.value=existingId?draft.name:'';name.placeholder='给这份设置起个名字';
  form.append(label('快照名称',name));
  form.append(createSnapshotScopePicker(draft.scope,()=>setBusy(busy)));
  const preset=node('select');preset.setAttribute('aria-label','预设选择');
  for(const value of new Set([draft.presetName,...model.presets]))addOption(preset,value,value);
  preset.value=draft.presetName;form.append(label('预设选择',preset));
  const presetDetails=node('details','pcm-snapshot-preset-details');presetDetails.open=true;
  presetDetails.dataset.snapshotScope='preset';
  const presetSummary=node('summary');const presetRows=node('div','pcm-snapshot-preset-rows');
  presetDetails.append(presetSummary,presetRows);form.append(presetDetails);
  const presetCache=new Map();
  preset.addEventListener('change',()=>run(async()=>{
    const selected=preset.value;
    presetCache.set(draft.presetName,{presetName:draft.presetName,orderCharacterId:draft.orderCharacterId,entries:draft.entries,groups:draft.groups,regex:draft.resources.regex.preset,editor:{entries:editor.entries,groups:editor.groups,regex:{preset:editor.regex?.preset},regexGroups:{preset:editor.regexGroups?.preset}}});
    try {
      const value=presetCache.get(selected)||await host.request('snapshot-draft-preset',{presetName:selected,contextKey:context.key});
      if(disposed)return;
      for(const key of ['presetName','orderCharacterId','entries','groups'])draft[key]=copy(value[key]);
      draft.resources.regex.preset=copy(value.regex||[]);
      editor={...editor,entries:value.editor?.entries||[],groups:value.editor?.groups||[],regex:{...editor.regex,preset:value.editor?.regex?.preset||[]},regexGroups:{...editor.regexGroups,preset:value.editor?.regexGroups?.preset||[]}};
      renderPreset();renderRegex();
    } catch(error){preset.value=draft.presetName;throw error;}
  }));
  const mounts=node('section','pcm-snapshot-field-group pcm-snapshot-global-mounts');mounts.append(node('h3','','全局世界书'));
  mounts.dataset.snapshotScope='worlds';
  const choices=node('div','pcm-snapshot-world-choices');mounts.append(choices);
  const bookCache=new Map(),bookViews=new Map();
  const contentCache=new Map((editor.worldEntries||[]).map(book=>[book.name,new Map(book.entries.map(entry=>[String(entry.uid),String(entry.content??'')]))]));
  for(const book of draft.resources.worldEntries)cacheBook(book);
  draft.resources.worldEntries=draft.resources.worlds.global.map(value=>bookCache.get(value)).filter(Boolean);
  draft.worldNames=[...draft.resources.worlds.global];
  const bookDetails=node('section','pcm-snapshot-book-configs');
  bookDetails.dataset.snapshotScope='worlds';
  const worldNames=[...new Set([...model.worldNames,...draft.resources.worlds.global])];
  if(!worldNames.length)choices.append(node('small','','没有可用世界书'));
  for(const value of worldNames){
    const checkbox=makeSwitch(value,draft.resources.worlds.global.includes(value));
    const row=switchRow(value,checkbox);row.classList.toggle('is-off',!checkbox.checked);
    checkbox.addEventListener('change',()=>run(async()=>{
      const next=checkbox.checked?[...draft.resources.worlds.global,value]:draft.resources.worlds.global.filter(n=>n!==value);
      try{await setWorlds(next);}catch(error){checkbox.checked=draft.resources.worlds.global.includes(value);throw error;}
      finally{row.classList.toggle('is-off',!checkbox.checked);}
    }));choices.append(row);
  }
  const regex=node('section','pcm-snapshot-editor-regex');
  regex.dataset.snapshotScope='regex';
  const controls=node('div','pcm-snapshot-editor-actions');
  const save=button('保存',()=>{if(existingId){saveChoices.hidden=false;}else void persist(false);});save.className='pcm-snapshot-primary';
  const cancel=button('取消编辑',onCancel);
  const saveChoices=node('div','pcm-snapshot-save-choices');saveChoices.hidden=true;
  saveChoices.append(node('span','','保存方式'),button('覆盖当前快照',()=>persist(true)),button('另存为一个新的快照',()=>persist(false)),button('返回编辑',()=>{saveChoices.hidden=true;}));
  controls.append(save,cancel);
  element.append(form,mounts,bookDetails,regex,node('p','pcm-snapshot-notice','这里的修改只保存在快照中，应用快照后才会改变酒馆设置。世界书正文只读，应用配置会影响所有引用同一本书的位置。'),status,controls,saveChoices);
  for(const warning of [...(model.warnings||[]),...(context.regexAuthorization||[])])form.append(node('p','pcm-snapshot-notice',warning));
  renderPreset();renderRegex();renderBooks();setBusy(false);

  function label(text,input,cls='pcm-snapshot-field') {const row=node('label',cls);row.append(node('span','',text),input);return row;}
  function switchRow(text,input){const row=node('label','pcm-snapshot-check pcm-snapshot-editor-switch-row');row.append(input,node('span','',text));return row;}
  function button(text,action){const b=node('button','',text);b.type='button';b.addEventListener('click',event=>{event.stopPropagation();action();});return b;}
  function addOption(select,value,text){const option=node('option','',text);option.value=String(value);select.append(option);}
  function makeSwitch(text,checked,unavailable=false){const input=node('input','pcm-native-switch');input.type='checkbox';input.checked=checked;input.setAttribute('aria-label',text);input.dataset.unavailable=String(unavailable);input.addEventListener('click',event=>event.stopPropagation());return input;}
  function setBusy(value){
    busy=value;element.setAttribute('aria-busy',String(value));
    for(const section of element.querySelectorAll('[data-snapshot-scope]'))section.hidden=!draft.scope[section.dataset.snapshotScope];
    for(const el of element.querySelectorAll('input,select,textarea,button'))el.disabled=(value&&el!==cancel)||el.dataset.unavailable==='true'||!!el.closest('[data-snapshot-scope][hidden]');
    preset.disabled=value||(!draft.scope.preset&&!draft.scope.regex);
  }
  async function run(action){if(busy||disposed)return;setBusy(true);status.textContent='';status.classList.remove('is-error');try{await action();}catch(error){if(!disposed){status.textContent=error.message;status.classList.add('is-error');toast.error(error.message);}}finally{if(!disposed)setBusy(false);}}
  function updatePresetSummary(){presetSummary.textContent='预设条目与分组 · '+draft.entries.filter(item=>item.enabled).length+'/'+draft.entries.length+' 条目开启';}
  function renderPreset(){
    updatePresetSummary();presetRows.replaceChildren();
    renderGrouped(presetRows,draft.entries,draft.groups,editor.entries||[],editor.groups||[],'identifier',false,updatePresetSummary,'预设');
  }
  function renderGrouped(target,items,groups,metadata,groupMetadata,idKey,unavailable,onChange,prefix){
    const records=new Map(metadata.map(item=>[String(item[idKey]),item]));
    const owners=new Map();
    for(const group of groupMetadata)for(const id of group.memberIds||[])owners.set(String(id),String(group.id));
    for(const item of metadata)if(item.groupId!==undefined&&item.groupId!==null)owners.set(String(item[idKey]),String(item.groupId));
    const knownGroups=new Set(groups.map(group=>String(group.id)));
    const ungrouped=items.filter(item=>!knownGroups.has(owners.get(String(item[idKey]))));
    if(!items.length&&!groups.length)target.append(node('p','pcm-snapshot-notice','没有'+(prefix==='预设'?'预设条目':'正则')));
    const batch=prefix!=='预设';
    function rows(container,members,group,updateGroup=()=>{}){
      const refresh=[];
      for(const item of members){
        const meta=records.get(String(item[idKey])),text=item.name||String(item[idKey]);
        const checkbox=makeSwitch(text,item.enabled,unavailable);
        const row=switchRow(text,checkbox);row.dataset.entryId=String(item[idKey]);
        if(meta?.missing){row.append(node('small','pcm-snapshot-missing','已缺失'));row.title='宿主中已找不到此条目，应用时将跳过';}
        const update=()=>{checkbox.checked=item.enabled;row.classList.toggle('is-off',!item.enabled||(!batch&&group?.enabled===false));};
        checkbox.addEventListener('change',()=>{item.enabled=checkbox.checked;update();updateGroup();onChange();});update();refresh.push(update);container.append(row);
      }
      return ()=>refresh.forEach(update=>update());
    }
    const sections=batch?groups.map(group=>({groupId:String(group.id),entries:items.filter(item=>owners.get(String(item[idKey]))===String(group.id))})):snapshotPresetSections(items,groups,metadata);
    if(batch&&ungrouped.length)sections.push({groupId:null,entries:ungrouped});
    const refreshSections=[];
    for(const {groupId,entries:members} of sections){
      const group=groups.find(group=>String(group.id)===groupId);
      if(!group){
        const body=node('div','pcm-snapshot-ungrouped');
        if(batch&&groups.length)body.append(node('p','pcm-snapshot-ungrouped-title','未分组'));
        rows(body,members);target.append(body);continue;
      }
      if(batch)members.sort((a,b)=>(records.get(a.id)?.order??0)-(records.get(b.id)?.order??0));
      const section=node('details','pcm-snapshot-editor-group');section.open=true;section.dataset.groupId=group.id;
      const summary=node('summary','pcm-snapshot-group-summary');
      const checkbox=makeSwitch((group.name||group.id)+' · 分组开关',batch?false:group.enabled,unavailable||(batch&&!members.length));
      const title=node('span','pcm-snapshot-group-name',group.name||group.id);
      summary.append(checkbox,title,node('small','',members.length+' 条'));
      const updateGroup=()=>{if(batch){const state=regexGroupState(items,members.map(item=>item.id));checkbox.checked=state.checked;checkbox.indeterminate=state.mixed;checkbox.title=state.mixed?'部分开启，点击全部开启':state.checked?'关闭组内全部正则':'开启组内全部正则';summary.classList.toggle('is-off',state.enabled===0);}else{checkbox.checked=group.enabled;summary.classList.toggle('is-off',!group.enabled);}};
      updateGroup();
      const body=node('div','pcm-snapshot-group-body'),refresh=rows(body,members,group,updateGroup);
      if(!members.length)body.append(node('small','pcm-snapshot-notice','此组没有条目'));
      refreshSections.push(()=>{updateGroup();refresh();});
      checkbox.addEventListener('change',()=>{if(batch){const next=toggleRegexGroup(items,members.map(item=>item.id),checkbox.checked);items.forEach((item,i)=>item.enabled=next[i].enabled);}else group.enabled=checkbox.checked;refreshSections.forEach(update=>update());onChange();});
      section.append(summary,body);target.append(section);
    }
  }
  function renderRegex(){
    const expanded=new Set([...regex.querySelectorAll('details[open][data-scope]')].map(el=>el.dataset.scope));
    regex.replaceChildren(node('h3','','正则开关'));
    for(const scope of scopes){
      const scripts=draft.resources.regex[scope]||[],groups=editor.regexGroups?.[scope]||[];
      const details=node('details','pcm-snapshot-regex-details');details.dataset.scope=scope;details.open=expanded.has(scope);
      const summary=node('summary');const update=()=>{summary.textContent=scopeNames[scope]+' · '+scripts.filter(s=>s.enabled).length+'/'+scripts.length+' 开启';};update();
      const choices=node('div','pcm-snapshot-regex-choices');
      renderGrouped(choices,scripts,groups,editor.regex?.[scope]||[],editor.regexGroups?.[scope]||[],'id',scope==='character'&&!context.canBindCharacter,update,scopeNames[scope]);
      details.append(summary,choices);regex.append(details);
    }
  }
  function cacheBook(book){
    const contents=contentCache.get(book.name)||new Map();
    for(const entry of book.entries){if(typeof entry.content==='string')contents.set(String(entry.uid),entry.content);delete entry.content;}
    contentCache.set(book.name,contents);bookCache.set(book.name,book);
  }
  async function setWorlds(names){
    const missing=names.filter(name=>!bookCache.has(name));
    if(missing.length){const values=await host.request('snapshot-draft-worlds',{names:missing,contextKey:context.key});if(disposed)return;for(const value of values)cacheBook(copy(value));}
    if(names.some(name=>!bookCache.has(name)))throw new Error('所选世界书未读取完成，请重试');
    draft.resources.worlds.global=[...new Set(names)];
    draft.resources.worldEntries=draft.resources.worlds.global.map(name=>bookCache.get(name));draft.worldNames=[...draft.resources.worlds.global];renderBooks();
  }
  function renderBooks(){
    bookDetails.replaceChildren(node('h3','','世界书条目配置'));
    if(!draft.resources.worldEntries.length)bookDetails.append(node('p','pcm-snapshot-notice','选择全局世界书后读取条目配置。'));
    for(const book of draft.resources.worldEntries){
      if(!bookViews.has(book.name))bookViews.set(book.name,createBookView(book));
      bookDetails.append(bookViews.get(book.name));
    }
  }
  function createBookView(book){
    const section=node('details','pcm-snapshot-book');section.dataset.book=book.name;
    section.append(node('summary','',book.name+' · '+book.entries.length+' 条'));
    for(const entry of book.entries)section.append(createWorldEntry(book,entry));
    if(!book.entries.length)section.append(node('p','pcm-snapshot-notice','这本世界书没有条目'));
    return section;
  }
  function createWorldEntry(book,entry){
    const row=node('details','pcm-snapshot-world-entry');row.dataset.uid=entry.uid;
    const summary=node('summary','pcm-snapshot-world-summary');
    const enabled=makeSwitch((entry.name||entry.uid)+' · 条目开关',!entry.settings.disable);
    const title=node('span','pcm-snapshot-world-name',entry.name||entry.uid);title.title=entry.name||entry.uid;
    const state=node('select','pcm-snapshot-trigger');state.setAttribute('aria-label','触发状态');state.title='触发状态：蓝色常驻 / 绿色关键词 / 紫色向量';
    for(const [value,text] of [['constant','🔵'],['keyword','🟢'],['vector','🟣']]){addOption(state,value,text);state.lastChild.label=({constant:'🔵 常驻',keyword:'🟢 关键词',vector:'🟣 向量'})[value];}
    const position=node('select','pcm-snapshot-position');position.setAttribute('aria-label','插入方式');position.title='插入位置';
    for(const [value,text] of [[0,'角色定义前'],[1,'角色定义后'],[2,'作者注释前'],[3,'作者注释后'],[4,'指定深度 @D'],[5,'示例消息前'],[6,'示例消息后'],[7,'出口']])addOption(position,value,text);
    function numeric(key,text,fallback){const input=node('input');input.type='number';input.step='any';input.value=entry.settings[key]??fallback;input.setAttribute('aria-label',text);input.title=text;return input;}
    const depth=numeric('depth','深度',4),order=numeric('order','顺序',100),probability=numeric('probability','概率',100);probability.min='0';probability.max='100';
    const numbers=node('span','pcm-snapshot-world-numbers');numbers.append(label('深度',depth),label('顺序',order),label('概率 %',probability));
    const placement=node('span','pcm-snapshot-world-placement');placement.append(position,numbers);
    summary.append(enabled,title,state,placement);
    const body=node('div','pcm-snapshot-world-body');
    const content=node('textarea','pcm-snapshot-world-content');content.readOnly=true;content.rows=5;content.spellcheck=false;content.setAttribute('aria-label','条目正文（只读）');
    content.value=contentCache.get(book.name)?.get(String(entry.uid))??'';
    content.placeholder=contentCache.get(book.name)?.has(String(entry.uid))?'正文为空':'宿主未提供此条目的正文';
    body.append(label('条目正文 · 只读',content));
    const fields=node('div','pcm-snapshot-entry-fields');
    const keys=node('textarea');keys.rows=2;keys.setAttribute('aria-label','主要关键词');
    const secondary=node('textarea');secondary.rows=2;secondary.setAttribute('aria-label','辅助关键词');
    fields.append(label('主要关键词 · 每行一个',keys),label('辅助关键词 · 每行一个',secondary));
    const toggles=[['selective','启用辅助关键词'],['useProbability','启用概率'],['excludeRecursion','排除递归'],['preventRecursion','阻止后续递归']].map(([key,text])=>({key,input:makeSwitch(text,entry.settings[key]===true),text}));
    const toggleFields=node('div','pcm-snapshot-world-toggles');for(const {input,text} of toggles)toggleFields.append(switchRow(text,input));
    const advanced=node('details','pcm-snapshot-json');advanced.append(node('summary','','全部条目配置（JSON）'));
    const json=node('textarea');json.rows=9;json.spellcheck=false;json.setAttribute('aria-label','全部条目配置');advanced.append(json);
    // 无效 JSON 留在原输入框，挂载/取消挂载或切换预设均不丢失尚未修正的文本。
    const syncJson=()=>{if(!json.validity.customError)json.value=JSON.stringify(entry.settings,null,2);};
    const syncDepthAvailability=()=>{
      const unavailable=Number(entry.settings.position??0)!==4;
      depth.dataset.unavailable=String(unavailable);depth.disabled=busy||unavailable;
      depth.title=unavailable?'仅指定深度插入时可设置':'深度';
      if(unavailable){depth.value=entry.settings.depth??4;depth.setCustomValidity('');}
    };
    const syncControls=()=>{
      const value=entry.settings;enabled.checked=!value.disable;summary.classList.toggle('is-off',!!value.disable);
      state.value=value.constant?'constant':value.vectorized?'vector':'keyword';state.dataset.state=state.value;
      if(![...position.options].some(option=>option.value===String(value.position??0)))addOption(position,value.position,'位置 '+value.position);
      position.value=String(value.position??0);depth.value=value.depth??4;order.value=value.order??100;probability.value=value.probability??100;
      for(const input of [depth,order,probability])input.setCustomValidity('');
      keys.value=(value.key||[]).join('\n');secondary.value=(value.keysecondary||[]).join('\n');
      for(const {key,input} of toggles)input.checked=value[key]===true;
      syncDepthAvailability();
    };
    enabled.addEventListener('change',()=>{entry.settings.disable=!enabled.checked;summary.classList.toggle('is-off',!enabled.checked);syncJson();});
    state.addEventListener('change',()=>{entry.settings.constant=state.value==='constant';entry.settings.vectorized=state.value==='vector';state.dataset.state=state.value;syncJson();});
    position.addEventListener('change',()=>{entry.settings.position=Number(position.value);syncDepthAvailability();syncJson();});
    for(const [input,key] of [[depth,'depth'],[order,'order'],[probability,'probability']])input.addEventListener('input',()=>{
      input.setCustomValidity('');
      if(input.value!==''&&Number.isFinite(input.valueAsNumber)&&input.validity.valid){entry.settings[key]=input.valueAsNumber;syncJson();}else input.setCustomValidity(key==='probability'?'概率须为 0–100 的数字':'请输入有效数字');
    });
    for(const [input,key] of [[keys,'key'],[secondary,'keysecondary']])input.addEventListener('input',()=>{entry.settings[key]=input.value.split('\n').map(s=>s.trim()).filter(Boolean);syncJson();});
    for(const {key,input} of toggles)input.addEventListener('change',()=>{entry.settings[key]=input.checked;syncJson();});
    function validSettings(value){
      if(!value||Array.isArray(value)||typeof value!=='object'||['content','comment','uid'].some(key=>Object.hasOwn(value,key)))return false;
      const safe=item=>item===null||typeof item!=='object'||Object.entries(item).every(([key,child])=>!['__proto__','constructor','prototype'].includes(key)&&safe(child));
      if(!safe(value))return false;
      for(const key of ['key','keysecondary'])if(value[key]!==undefined&&(!Array.isArray(value[key])||value[key].some(item=>typeof item!=='string')))return false;
      for(const key of ['position','depth','order','probability'])if(value[key]!==undefined&&!Number.isFinite(value[key]))return false;
      if(value.probability!==undefined&&(value.probability<0||value.probability>100))return false;
      for(const key of ['disable','constant','vectorized','selective','useProbability','excludeRecursion','preventRecursion'])if(value[key]!==undefined&&typeof value[key]!=='boolean')return false;
      return true;
    }
    json.addEventListener('input',()=>{try{const value=JSON.parse(json.value);if(!validSettings(value))throw Error();entry.settings=value;json.setCustomValidity('');syncControls();}catch{json.setCustomValidity('请输入有效的条目配置 JSON；不能包含正文、名称或 UID，概率须为 0–100');}});
    for(const control of [state,position,depth,order,probability])control.addEventListener('click',event=>event.stopPropagation());
    syncControls();syncJson();body.append(fields,toggleFields,advanced);row.append(summary,body);return row;
  }
  async function persist(overwrite){
    if(busy||disposed)return;
    for(const input of element.querySelectorAll('input,select,textarea'))if(!input.checkValidity()){
      let parent=input.parentElement;while(parent&&parent!==element){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
      input.reportValidity();status.textContent=input.validationMessage||'请检查配置';status.classList.add('is-error');return;
    }
    await run(async()=>{
      snapshotScope(draft);
      const value=name.value.trim();if(!value)throw new Error('请输入快照名称');
      const result=await host.request('snapshot-save-draft',{id:overwrite?existingId:undefined,name:value,draft:copy(draft),contextKey:context.key});
      if(!disposed){toast.success(overwrite?'快照已更新':'快照已保存');onSaved(result);}
    });
  }
  return {element,destroy(){disposed=true;bookViews.clear();bookCache.clear();presetCache.clear();element.remove();}};
}
