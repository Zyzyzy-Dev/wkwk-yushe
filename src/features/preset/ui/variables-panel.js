// 预设变量面板：获取/引用/编辑三个视图、局部草稿表单及批量变更预览；通过回调写入预设草稿。
import {VARIABLE_KINDS, scanVariables, collectVariables, variableKey, makeVariable, missingVariableInitializers,
  planVariableInitializers, planVariableAdd, planVariableEdit, planVariableRename} from '../variables.js';
import {buildRows, diffLines} from '../core.js';

const kindNames = {setvar:'设置 · setvar',addvar:'追加 · addvar',getvar:'读取 · getvar',setglobalvar:'全局设置 · setglobalvar',addglobalvar:'全局追加 · addglobalvar',getglobalvar:'全局读取 · getglobalvar'};
function node(tag, className = '', text) {
  const item = document.createElement(tag); item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function button(text, action) {
  const item = node('button', 'menu_button', text); item.type = 'button'; item.addEventListener('click', action); return item;
}
function field(label, control) {
  const item = node('label', 'pcm-variable-field'); item.append(node('span','',label), control); return item;
}
function input(label, value = '') {
  const item = node('input'); item.value = value; item.setAttribute('aria-label', label); return item;
}
function kindSelect(kind) {
  const select = node('select'); select.setAttribute('aria-label','宏类型');
  for (const value of VARIABLE_KINDS.filter(value=>value.includes('global')===kind.includes('global'))) select.add(new Option(kindNames[value], value));
  select.value = kind; return select;
}

export function openVariablesPanel({dialog, title, getPrompts, getPresentation, apply, undo, confirm, isInjected = () => true}) {
  const root = node('section','pcm-picker open'); root.dataset.varsPanel = '';
  root.setAttribute('role','dialog'); root.setAttribute('aria-label','预设变量');
  const box = node('div','pcm-picker-panel pcm-variable-panel');
  const header = node('header','pcm-picker-head');
  const undoButton=button('↶',async()=>{if(await discard())attempt(()=>{undo(); dirty=false; render();});});undoButton.setAttribute('aria-label','撤回');undoButton.title='撤回';
  const closeButton=button('×',()=>void close());closeButton.setAttribute('aria-label','关闭');closeButton.title='关闭';
  header.append(node('h3','','变量 · '+title),undoButton,closeButton);
  const tabs = node('nav','pcm-variable-tabs'); tabs.setAttribute('aria-label','变量视图');
  const body = node('div','pcm-variable-body'), message = node('div','pcm-variable-message'); message.setAttribute('role','status');
  box.append(header,tabs,message,body); root.append(box); dialog.append(root);
  const candidates = () => getPrompts().filter(p=>!p.marker);
  let view='get', dirty=false, targetId=null, searchValue='';
  const initial = candidates().filter(p=>scanVariables(p.content).some(m=>m.kind.startsWith('set'))).sort((a,b)=>scanVariables(b.content).filter(m=>m.kind.startsWith('set')).length-scanVariables(a.content).filter(m=>m.kind.startsWith('set')).length)[0];
  targetId=initial?.identifier;
  const attempt = action => {try {message.textContent=''; return action();} catch(error) {message.textContent=error.message;}};
  async function discard() {return !dirty || await confirm('当前表单还有未应用的修改，放弃这些修改吗？');}
  async function close() {if(await discard())root.remove();}
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();void close();}});
  const markDirty = () => {dirty=true;};
  for (const [key,label] of [['get','获取变量'],['ref','引用变量'],['edit','编辑变量']]) {
    const tab=button(label,async()=>{if(key===view)return;if(!(await discard())||!root.isConnected)return;view=key;dirty=false;render();});
    tab.dataset.variableView=key;tabs.append(tab);
  }
  function commit(changes) {
    if(!changes.length){message.textContent='没有需要修改的内容（相同宏会自动跳过）';return;}
    apply(changes);dirty=false;render();message.textContent='已更新 '+changes.length+' 个条目的草稿，可撤回；保存回酒馆后生效';
  }
  function preview(changes, heading, extra='') {
    if (!changes.length) {message.textContent='没有需要修改的内容（相同宏会自动跳过）';return;}
    const previous=[...body.childNodes], previousDirty=dirty;
    body.replaceChildren();
    body.append(node('h4','',heading),node('p','pcm-variable-note',extra || '核对下列条目，确认后仅更新当前侧预设草稿。'));
    const actions=node('div','pcm-variable-actions');
    actions.append(button('返回修改',()=>{body.replaceChildren(...previous);dirty=previousDirty;}),button('确认应用',()=>attempt(()=>commit(changes))));body.append(actions);
    for(const item of changes) {
      const card=node('details','pcm-variable-preview');card.open=changes.length===1;
      card.append(node('summary','',item.name));
      const paint=()=>{
        if(!card.open||card.dataset.painted)return;card.dataset.painted='true';
        const rows=buildRows(diffLines(item.before,item.after));
        card.append(node('p','pcm-variable-note','红色：删除／原内容　绿色：新增／新内容'));
        for(const [side,label] of [['-','修改前'],['+','修改后']]){
          const pre=node('pre','pcm-variable-diff');const visible=rows.filter(row=>row.t===' '||row.t===side);
          visible.forEach((row,index)=>{if(index)pre.append(document.createTextNode('\n'));for(const segment of row.segs){if(segment.t!==' '&&segment.t!==side)continue;pre.append(segment.t===' '?document.createTextNode(segment.text):node('mark',side==='-'?'pcm-variable-del':'pcm-variable-add',segment.text));}});
          card.append(node('h5','',label),pre);
        }
      };card.addEventListener('toggle',paint);body.append(card);paint();
    }
    dirty=true;
  }
  function render() {
    body.replaceChildren();message.textContent='';
    root.dataset.view=view;
    for(const tab of tabs.children)tab.setAttribute('aria-pressed',String(tab.dataset.variableView===view));
    if(view==='edit')renderEditor();else renderCollection();
  }
  function targetPicker() {
    const choices=candidates();
    const target=choices.find(p=>p.identifier===targetId);
    if(target){const row=node('div','pcm-variable-target');row.append(node('span','','获取变量初始化条目：'),node('strong','',target.name||'(未命名)'));body.append(row);}
    return target;
  }
  function renderCollection() {
    const target=targetPicker();
    if(!target){body.append(node('p','','未识别到初始化变量条目。可在“编辑变量”添加 setvar 后重新打开变量面板。'));return;}
    const original=String(target.content??''), groups=collectVariables(candidates());
    const definitions=scanVariables(original).filter(m=>m.kind.startsWith('set'));
    const reads=new Set(groups.filter(g=>g.occurrences.some(m=>m.kind.startsWith('get')&&isInjected(m.id))).map(g=>g.key));
    const unreferenced=definitions.filter(m=>!reads.has(variableKey(m)));
    if(view==='ref') {
      const pre=node('pre','pcm-variable-reference');pre.setAttribute('aria-label','获取变量条目原文（已引用高亮）');let cursor=0;
      for(const m of definitions.filter(m=>reads.has(variableKey(m)))){if(m.start<cursor)continue;pre.append(document.createTextNode(original.slice(cursor,m.start)));pre.append(node('mark','pcm-variable-referenced',m.raw));cursor=m.end;}
      pre.append(document.createTextNode(original.slice(cursor)));body.append(pre);
      const keys=[...new Set(unreferenced.map(m=>(m.scope==='global'?'全局 · ':'')+m.name))];
      const summary=node('div','pcm-variable-reference-summary');summary.append(node('span','',unreferenced.length+' 处定义未被引用'));
      const chips=node('div','pcm-variable-chips');for(const name of keys)chips.append(node('code','pcm-variable-unreferenced',name));summary.append(chips);body.append(summary);
      body.append(node('p','pcm-variable-note','原文高亮表示已被引用；统计范围为已注入条目。修改原文请切换到“获取变量”。'));return;
    }
    const raw=node('textarea');raw.setAttribute('aria-label','获取变量条目原文');raw.value=original;raw.rows=8;raw.addEventListener('input',markDirty);
    raw.classList.add('pcm-variable-original');body.append(raw);const save=button('保存',()=>attempt(()=>{
      if(raw.value===original){dirty=false;return;}
      commit([{id:target.identifier,name:target.name,before:original,after:raw.value}]);
    }));save.setAttribute('aria-label','保存条目内容');body.querySelector('.pcm-variable-target').append(save);
    const requireSaved=()=>{if(raw.value!==original)throw new Error('请先保存条目原文的修改，再补写变量');};
    const missing=missingVariableInitializers(candidates(),targetId);
    const section=node('section','pcm-variable-section');section.append(node('h4','','未收录的变量 · '+missing.length));
    for(const group of missing){
      const row=node('div','pcm-variable-source');
      const sources=[...new Set(group.occurrences.filter(m=>m.id!==targetId&&/^(set|add)/.test(m.kind)).map(m=>m.entryName))];
      row.append(node('strong','',(group.scope==='global'?'全局 · ':'')+group.name),node('span','',sources.join('、')),
        button('写入',()=>attempt(()=>{requireSaved();preview(planVariableInitializers(candidates(),targetId,[group.key]),'写入 '+group.name);})));
      section.append(row);
    }
    if(!missing.length)section.append(node('p','pcm-variable-note','其他条目的设置／追加变量均已收录'));
    if(missing.length){const actions=node('div','pcm-variable-actions pcm-variable-end');actions.append(button('一键写入变量',()=>attempt(()=>{requireSaved();preview(planVariableInitializers(candidates(),targetId),'一键写入变量','按名称及作用域去重，只补空值 setvar；已有值和来源正文保持不变。初始化应先于 addvar 执行。');})));section.append(actions);}
    body.append(section);
    const undefinedGroups=groups.filter(g=>g.occurrences.some(m=>m.kind.startsWith('get')&&isInjected(m.id))&&!g.occurrences.some(m=>m.kind.startsWith('set')&&isInjected(m.id)));
    if(undefinedGroups.length){const section=node('section','pcm-variable-section');section.append(node('h4','','被引用但没有 setvar 初始化'));
      for(const group of undefinedGroups){const row=node('div','pcm-variable-source');row.append(node('strong','',(group.scope==='global'?'全局 · ':'')+group.name),button('补写',()=>attempt(()=>{
        requireSaved();
        const plan=planVariableAdd(candidates(),[targetId],{kind:group.scope==='global'?'setglobalvar':'setvar',name:group.name});preview(plan,'补写 '+group.name);
      })));section.append(row);}body.append(section);
    }
  }
  function renderEditor() {
    const bar=node('div','pcm-variable-actions');
    const search=input('搜索变量或条目',searchValue);search.type='search';search.placeholder='搜索变量或条目';
    bar.append(search,button('添加变量',()=>renderAdd()));body.append(bar);
    const list=node('div');body.append(list);
    const groups=collectVariables(candidates());
    const draw=()=>{
      list.replaceChildren();const query=search.value.trim().toLocaleLowerCase();searchValue=search.value;
      for(const group of groups.filter(g=>[g.name,...g.occurrences.map(m=>m.entryName)].some(s=>s.toLocaleLowerCase().includes(query)))) {
        const card=node('details','pcm-variable-group');
        const summary=node('summary','');summary.append(node('span','',(group.scope==='global'?'全局 · ':'')+group.name+' · '+group.occurrences.length+' 处'));
        const rename=button('批量重命名',event=>{event.preventDefault();event.stopPropagation();renderRename(group);});summary.append(rename);card.append(summary);
        card.addEventListener('toggle',()=>{if(!card.open||card.dataset.loaded)return;card.dataset.loaded='true';
          for(const occurrence of group.occurrences){const row=node('div','pcm-variable-source');row.append(node('strong','',occurrence.entryName),node('code','',occurrence.kind+' · 第 '+(String(getPrompts().find(p=>p.identifier===occurrence.id)?.content??'').slice(0,occurrence.start).split('\n').length)+' 行'),button('修改此处',()=>renderOccurrence(occurrence)));card.append(row);}
        });list.append(card);
      }
      if(!list.childElementCount)list.append(node('p','pcm-variable-note','没有匹配的变量；可点击“添加变量”创建'));
    };
    search.addEventListener('input',draw);draw();
  }
  function formHeading(text) {body.replaceChildren();const bar=node('div','pcm-variable-form-heading');bar.append(node('h4','',text),button('返回编辑变量',async()=>{if(await discard()){dirty=false;render();}}));body.append(bar);message.textContent='';}
  function macroFields(kind='setvar',name='',value=' ') {
    const select=kindSelect(kind),nameInput=input('变量名',name),area=node('textarea');area.value=value;area.rows=5;area.setAttribute('aria-label','变量内容');
    const global=node('input');global.type='checkbox';global.checked=kind.includes('global');
    const scope=node('label','pcm-variable-scope');scope.append(global,document.createTextNode('使用全局变量（跨聊天共享）'));
    global.addEventListener('change',()=>{
      const operation=select.value.startsWith('set')?'set':select.value.startsWith('add')?'add':'get';
      select.replaceChildren();for(const value of VARIABLE_KINDS.filter(v=>v.includes('global')===global.checked))select.add(new Option(kindNames[value],value));
      select.value=operation+(global.checked?'globalvar':'var');dirty=true;select.dispatchEvent(new Event('change'));
    });
    for(const control of [select,nameInput,area])control.addEventListener('input',markDirty);
    body.append(field('宏类型',select),scope,field('变量名',nameInput),field('变量内容（可留空，以后填写）',area));
    return {select,nameInput,area};
  }
  function renderAdd() {
    formHeading('添加变量');
    const selected=new Set(),search=input('搜索预设条目');search.type='search';search.placeholder='搜索条目名称、正文或分组';
    const count=node('span','pcm-variable-count'),list=node('div','pcm-variable-picklist');body.querySelector('.pcm-variable-form-heading').insertBefore(count,body.querySelector('.pcm-variable-form-heading button'));
    const map=new Map(candidates().map(p=>[p.identifier,p]));
    const choices=(getPresentation?.()||candidates().map(p=>({id:p.identifier}))).filter(item=>map.has(item.id)).map(item=>({...item,prompt:map.get(item.id)}));
    const shown=()=>choices.filter(item=>[item.prompt.name,item.prompt.content,item.groupName].join('\n').toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
    const collapsed=new Set();
    const draw=()=>{count.textContent='已选 '+selected.size+' 个条目';list.replaceChildren();let previous=null,container=list,segment=0;for(const item of shown()){
      const p=item.prompt;
      if(item.grouped&&item.groupId!==previous){previous=item.groupId;const group=node('details','pcm-variable-choice-group'),key=String(item.groupId)+':'+segment++;group.open=!!search.value.trim()||!collapsed.has(key);group.append(node('summary','',item.groupName));group.addEventListener('toggle',()=>{group.open?collapsed.delete(key):collapsed.add(key);});container=node('div');group.append(container);list.append(group);}
      const check=node('input');check.type='checkbox';check.checked=selected.has(p.identifier);check.setAttribute('aria-label','选择条目 '+(p.name||'(未命名)'));
      check.dataset.variableEntry=p.identifier;
      check.addEventListener('change',()=>{check.checked?selected.add(p.identifier):selected.delete(p.identifier);dirty=true;count.textContent='已选 '+selected.size+' 个条目';});
      const label=node('label');label.append(check,node('span','',p.name||'(未命名)'));container.append(label);
    }if(!list.childElementCount)list.append(node('p','','没有匹配条目'));};
    const selectionBar=node('div','pcm-variable-actions pcm-variable-selection-bar');selectionBar.append(search,button('全选搜索结果',()=>{shown().forEach(item=>selected.add(item.id));dirty=true;draw();}),button('清空选择',()=>{selected.clear();dirty=true;draw();}));
    body.append(selectionBar,list);search.addEventListener('input',draw);draw();
    const modes=node('fieldset','pcm-variable-modes');modes.append(node('legend','','添加方式'));
    let mode='append';
    for(const [key,text] of [['append','底部添加变量宏'],['wrap','整段正文转成变量内容']]){const radio=node('input');radio.type='radio';radio.name='pcm-variable-mode';radio.value=key;radio.checked=key===mode;const label=node('label');label.append(radio,document.createTextNode(text));modes.append(label);radio.addEventListener('change',()=>{mode=key;dirty=true;update();});}
    body.append(modes);const {select,nameInput,area}=macroFields();
    const kindField=select.closest('label');kindField.hidden=true;
    const kinds=node('fieldset','pcm-variable-kind-buttons');kinds.append(node('legend','','宏类型'));
    kindField.after(kinds);
    const drawKinds=()=>{kinds.querySelectorAll('label').forEach(el=>el.remove());for(const option of select.options){const radio=node('input');radio.type='radio';radio.name='pcm-variable-add-kind';radio.value=option.value;radio.checked=option.selected;radio.disabled=option.disabled;const label=node('label');label.append(radio,node('span','',option.value));radio.addEventListener('change',()=>{select.value=radio.value;dirty=true;select.dispatchEvent(new Event('change'));});kinds.append(label);}};
    const hint=node('p','pcm-variable-note');body.append(hint);
    const update=()=>{
      for(const option of select.options)option.disabled=mode==='wrap'&&option.value.startsWith('get');
      if(mode==='wrap'&&select.value.startsWith('get'))select.value=select.value.includes('global')?'setglobalvar':'setvar';
      area.disabled=mode==='wrap'||select.value.startsWith('get');
      area.closest('label').hidden=area.disabled;
      hint.textContent=mode==='wrap'?'每个条目的完整原文会放进所选宏，不在宏外保留副本。多条内容需要合并时用 addvar；多个 setvar 会依次覆盖。已有嵌套宏会保留，执行效果需按酒馆版本核对。':'在所选条目末尾换行添加；完全相同的宏会跳过。getvar 只读取变量，无内容字段。';
      drawKinds();
    };select.addEventListener('change',update);update();
    const plan=()=>planVariableAdd(candidates(),[...selected],{kind:select.value,name:nameInput.value,value:area.value||' ',mode});
    const actions=node('div','pcm-variable-actions pcm-variable-save-actions');actions.append(button('预览添加',()=>attempt(()=>preview(plan(),mode==='wrap'?'预览整段转换':'预览底部添加',hint.textContent))),button('保存添加',()=>attempt(()=>commit(plan()))));body.append(actions);
  }
  function renderOccurrence(occurrence) {
    formHeading('修改变量 · '+occurrence.entryName);
    const {select,nameInput,area}=macroFields(occurrence.kind,occurrence.name,occurrence.value);
    const update=()=>{area.disabled=select.value.startsWith('get');area.closest('label').hidden=area.disabled;};select.addEventListener('change',update);update();
    body.append(node('p','pcm-variable-note','只修改选中的这一处宏；若切换为 getvar，其原有内容将被移除，请核对预览。'));
    body.append(button('预览修改',()=>attempt(()=>preview(planVariableEdit(candidates(),occurrence.id,occurrence,{kind:select.value,name:nameInput.value,value:area.value}),'预览单处修改'))));
  }
  function renderRename(group) {
    formHeading('批量重命名 · '+group.name);
    const name=input('新变量名',group.name);name.addEventListener('input',markDirty);body.append(field('新变量名',name));
    body.append(node('p','pcm-variable-note','将修改当前侧预设中此变量的全部设置、追加和读取位置；不同作用域不受影响。'));
    body.append(button('预览重命名',()=>attempt(()=>preview(planVariableRename(candidates(),group.scope,group.name,name.value),'预览批量重命名'))));
  }
  render();
  return {element:root,destroy:()=>root.remove(),refresh(){dirty=false;render();}};
}
