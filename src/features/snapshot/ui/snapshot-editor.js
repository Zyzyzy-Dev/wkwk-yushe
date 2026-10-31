// 快照草稿编辑页：独立编辑预设/正则分组、世界书挂载和条目开关及推理设置，正文只读，保存前不改变宿主。
import {regexGroupState, toggleRegexGroup} from '../snapshot-resources.js';
import {snapshotPresetSections, snapshotScope} from '../snapshot.js';
import {createSnapshotScopePicker} from './snapshot-scope.js';
import {createSnapshotReasoningForm} from './snapshot-reasoning-form.js';
import {captureFullSnapshotReasoning} from '../snapshot-reasoning.js';
export function createSnapshotEditor({host, model, existingId, onCancel, onSaved, toast, prompt, confirm}) {
  const copy=value=>JSON.parse(JSON.stringify(value));
  const draft=copy(model.draft),context=model.context;
  draft.scope=snapshotScope(draft);
  const reasoningValue=model.reasoning?.current?captureFullSnapshotReasoning({...model.reasoning.current,...draft.reasoning}):null;
  let editor=copy(model.editor||{}),disposed=false,busy=false;
  draft.resources.version=2;
  draft.resources.worlds={global:[...draft.resources.worlds.global]};
  const scopes=['preset','global'],scopeNames={global:'全局正则',preset:'预设正则',character:'角色正则'};
  const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const element=node('section','pcm-snapshot-editor');element.setAttribute('aria-label',existingId?'修改快照':'创建快照');
  const status=node('p','pcm-snapshot-status');status.setAttribute('role','status');
  const form=node('div','pcm-snapshot-form');
  const name=node('input');name.type='text';name.maxLength=120;name.value=existingId?draft.name:'';name.placeholder='给这份设置起个名字';
  form.append(label('快照名称',name));
  form.append(createSnapshotScopePicker(draft.scope,key=>{if(key==='reasoning'&&draft.scope.reasoning&&reasoningValue)draft.reasoning={...reasoningValue};setBusy(busy);}));
  const preset=node('select');preset.setAttribute('aria-label','预设选择');
  const presetNames=[...new Set([draft.presetName,...model.presets])];
  const presetSearch=node('input');presetSearch.type='search';presetSearch.placeholder='搜索预设';presetSearch.setAttribute('aria-label','搜索预设');
  function filterPresets(){
    const selected=draft.presetName,query=presetSearch.value.trim().toLocaleLowerCase();
    preset.replaceChildren();
    for(const value of presetNames)if(value===selected||value.toLocaleLowerCase().includes(query))addOption(preset,value,value);
    preset.value=selected;
  }
  presetSearch.addEventListener('input',filterPresets);filterPresets();
  const presetField=label('预设选择',presetSearch);presetField.append(preset);form.append(presetField);
  const presetDetails=node('details','pcm-snapshot-preset-details');presetDetails.open=true;
  presetDetails.dataset.snapshotScope='preset';
  const presetSummary=node('summary');const presetRows=node('div','pcm-snapshot-preset-rows');
  presetDetails.append(presetSummary,presetRows);form.append(presetDetails);
  const presetCache=new Map();
  preset.addEventListener('change',()=>run(async()=>{
    const selected=preset.value;
    presetCache.set(draft.presetName,{presetName:draft.presetName,orderCharacterId:draft.orderCharacterId,entries:draft.entries,groups:draft.groups,presetRegex:draft.presetRegex,editor:{entries:editor.entries,groups:editor.groups,regex:{preset:editor.regex?.preset},regexGroups:{preset:editor.regexGroups?.preset}}});
    try {
      const value=presetCache.get(selected)||await host.request('snapshot-draft-preset',{presetName:selected,contextKey:context.key});
      if(disposed)return;
      for(const key of ['presetName','orderCharacterId','entries','groups'])draft[key]=copy(value[key]);
      draft.presetRegex=copy(value.presetRegex);
      editor={...editor,entries:value.editor?.entries||[],groups:value.editor?.groups||[],regex:{...editor.regex,preset:value.editor?.regex?.preset||[]},regexGroups:{...editor.regexGroups,preset:value.editor?.regexGroups?.preset||[]}};
      renderPreset();renderRegex();
    } catch(error){preset.value=draft.presetName;throw error;}
  }));
  const mounts=node('section','pcm-snapshot-field-group pcm-snapshot-global-mounts');mounts.append(node('h3','','全局世界书'));
  mounts.dataset.snapshotScope='worlds';
  const worldSearch=node('input');worldSearch.type='search';worldSearch.placeholder='搜索全局世界书';worldSearch.setAttribute('aria-label','搜索全局世界书');
  const choices=node('div','pcm-snapshot-world-choices');mounts.append(worldSearch,choices);
  worldSearch.addEventListener('input',()=>{
    const query=worldSearch.value.trim().toLocaleLowerCase();
    for(const row of choices.querySelectorAll('label'))row.hidden=!row.textContent.toLocaleLowerCase().includes(query);
  });
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
  const reasoning=node('section','pcm-snapshot-editor-reasoning');reasoning.dataset.snapshotScope='reasoning';reasoning.append(node('h3','','推理设置'));
  if(reasoningValue){
    reasoning.append(createSnapshotReasoningForm({value:reasoningValue,templates:model.reasoning.templates,host,contextKey:context.key,run,prompt,confirm,isDisposed:()=>disposed,onChange:()=>{draft.reasoning={...reasoningValue};}}).element);
    if(draft.reasoning?.version===1)reasoning.append(node('small','pcm-snapshot-notice','旧快照仅保存自动解析和格式。修改这里的推理选项或重新开启推理保存范围后，才会保存全部推理设置。'));
  }
  else reasoning.append(node('p','pcm-snapshot-notice',model.reasoning?.error||'推理设置尚未读取，请重新打开编辑页'));
  const controls=node('div','pcm-snapshot-editor-actions');
  const save=button('保存',()=>{if(existingId){saveChoices.hidden=false;}else void persist(false);});save.className='pcm-snapshot-primary';
  const cancel=button('取消编辑',onCancel);
  const saveChoices=node('div','pcm-snapshot-save-choices');saveChoices.hidden=true;
  saveChoices.append(node('span','','保存方式'),button('覆盖当前快照',()=>persist(true)),button('另存为一个新的快照',()=>persist(false)),button('返回编辑',()=>{saveChoices.hidden=true;}));
  controls.append(save,cancel);
  mounts.append(bookDetails);
  element.append(form,mounts,regex,reasoning,node('p','pcm-snapshot-notice','开关和格式只保存在快照中，应用快照后才会改变酒馆设置。世界书正文只读，应用配置会影响所有引用同一本书的位置。'),status,controls,saveChoices);
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
    regex.hidden=!draft.scope.preset&&!draft.scope.regex;
    for(const section of regex.querySelectorAll('[data-preset-regex-controls]'))section.hidden=!draft.scope.presetRegex;
    for(const el of element.querySelectorAll('input,select,textarea,button'))el.disabled=(value&&el!==cancel)||el.dataset.unavailable==='true'||!!el.closest('[data-snapshot-scope][hidden]');
    preset.disabled=value||!draft.scope.preset;
    presetSearch.disabled=preset.disabled;
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
        const row=batch?switchRow(text,checkbox):node('div','pcm-snapshot-check pcm-snapshot-editor-switch-row');row.dataset.entryId=String(item[idKey]);
        const wrapper=batch?row:node('div','pcm-snapshot-preset-entry');
        if(!batch){
          const body=node('div','pcm-snapshot-preset-content');body.hidden=true;body.setAttribute('role','region');body.setAttribute('aria-label',text+' · 正文（只读）');
          const title=button('',()=>{
            body.hidden=!body.hidden;title.setAttribute('aria-expanded',String(!body.hidden));
            // 展开时才建立正文节点，避免长预设首次打开快照页就排版全部正文。
            if(!body.hidden&&!body.childNodes.length){
              body.append(node('small','',meta?.missing?'宿主中已找不到此条目':'条目正文 · 只读（当前预设）'));
              body.append(node('pre','',meta?.missing?'无法读取正文':typeof meta?.content==='string'?(meta.content||'正文为空'):'宿主未提供此条目的正文'));
            }
          });
          title.className='pcm-snapshot-preset-entry-title';title.setAttribute('aria-expanded','false');title.title='展开或收起正文';
          const caret=node('span','pcm-snapshot-entry-caret','▸');caret.setAttribute('aria-hidden','true');title.append(caret,node('span','',text));
          row.append(checkbox,title);wrapper.append(row,body);
        }
        if(meta?.missing){row.append(node('small','pcm-snapshot-missing','已缺失'));row.title='宿主中已找不到此条目，应用时将跳过';}
        const update=()=>{checkbox.checked=item.enabled;row.classList.toggle('is-off',!item.enabled||(!batch&&group?.enabled===false));};
        checkbox.addEventListener('change',()=>{item.enabled=checkbox.checked;update();updateGroup();onChange();});update();refresh.push(update);container.append(wrapper);
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
    regex.replaceChildren(node('h3','','正则设置'));
    for(const scope of scopes){
      const region=node('div');region.dataset.snapshotScope=scope==='preset'?'preset':'regex';
      if(scope==='preset'){
        region.dataset.presetRegexRegion='';
        const toggle=makeSwitch('预设正则快照',draft.scope.presetRegex);
        toggle.addEventListener('change',()=>{draft.scope.presetRegex=toggle.checked;setBusy(busy);});
        region.append(switchRow('预设正则快照',toggle),node('small','pcm-snapshot-notice','保存所选预设正则开关状态，应用快照时随快照切换。'),node('p','pcm-snapshot-notice','所选预设：'+draft.presetName));
        const reload=button('重新读取所选预设正则',()=>run(async()=>{
          if(!await confirm('重新读取「'+draft.presetName+'」的正则及开关？这会替换本页该范围未保存的修改，其他设置保留。'))return;
          if(disposed)return;
          const value=await host.request('snapshot-draft-preset',{presetName:draft.presetName,contextKey:context.key});
          if(disposed)return;
          draft.presetRegex=copy(value.presetRegex);
          editor.regex={...editor.regex,preset:value.editor?.regex?.preset||[]};
          editor.regexGroups={...editor.regexGroups,preset:value.editor?.regexGroups?.preset||[]};
          presetCache.delete(draft.presetName);
          renderRegex();status.textContent='已重新读取所选预设正则，请核对开关后保存。';
        }));
        reload.title='重新捕获当前规则定义和开关，仅替换本页的预设正则草稿';region.append(reload);
      }
      const scripts=scope==='preset'?(draft.presetRegex?.switches||[]):(draft.resources.regex[scope]||[]),groups=editor.regexGroups?.[scope]||[];
      const details=node('details','pcm-snapshot-regex-details');details.dataset.scope=scope;details.open=expanded.has(scope);
      if(scope==='preset')details.dataset.presetRegexControls='';
      const summary=node('summary');const update=()=>{summary.textContent=scopeNames[scope]+' · '+scripts.filter(s=>s.enabled).length+'/'+scripts.length+' 开启';};update();
      const choices=node('div','pcm-snapshot-regex-choices');
      renderGrouped(choices,scripts,groups,editor.regex?.[scope]||[],editor.regexGroups?.[scope]||[],'id',scope==='character'&&!context.canBindCharacter,update,scopeNames[scope]);
      details.append(summary,choices);region.append(details);regex.append(region);
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
    summary.append(enabled,title);
    const body=node('div','pcm-snapshot-world-body');
    const content=node('textarea','pcm-snapshot-world-content');content.readOnly=true;content.rows=5;content.spellcheck=false;content.setAttribute('aria-label','条目正文（只读）');
    content.value=contentCache.get(book.name)?.get(String(entry.uid))??'';
    content.placeholder=contentCache.get(book.name)?.has(String(entry.uid))?'正文为空':'宿主未提供此条目的正文';
    body.append(label('条目正文 · 只读',content));
    // 只编辑条目开关；其它已保存配置原样保留，不因精简界面重置。
    summary.classList.toggle('is-off',!!entry.settings.disable);
    enabled.addEventListener('change',()=>{
      entry.settings.disable=!enabled.checked;
      summary.classList.toggle('is-off',!enabled.checked);
    });
    row.append(summary,body);return row;
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
      if(!disposed){
        if(result?.persistence?.verified===false)toast.warning(result.persistence.message||'保存请求已提交，当前页面保留改动，请稍后重新核验，勿重复创建快照。');
        else toast.success(overwrite?'快照已更新':'快照已保存');
        // Leave the create form after an accepted write even if readback is unavailable, avoiding a duplicate save.
        onSaved(result);
      }
    });
  }
  return {element,destroy(){disposed=true;bookViews.clear();bookCache.clear();presetCache.clear();element.remove();}};
}
