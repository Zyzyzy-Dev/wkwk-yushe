// 设置快照页面：保存、恢复与聊天/角色绑定，通过 iframe 通信桥调用宿主，不访问酒馆全局。
import { createSnapshotEditor } from './snapshot-editor.js';
import { snapshotScope } from '../snapshot.js';
import { createSnapshotScopePicker, snapshotScopeLabels } from './snapshot-scope.js';
export function createSnapshotPanel({host, onBack, onClose, onCycleTheme, themeIcon, prompt, confirm, toast}) {
  const node = (tag, cls, text) => {const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n;};
  const element = node('main', 'pcm-snapshots');
  element.setAttribute('aria-label', '设置快照');
  const header = node('header', 'pcm-snapshot-header');
  const back = button('← 首页', () => editor ? closeEditor() : onBack()), title = node('h2', '', '设置快照');
  const theme = button('', onCycleTheme); theme.dataset.themeToggle = ''; theme.title = '切换配色'; theme.setAttribute('aria-label', '切换配色'); theme.innerHTML = themeIcon;
  const close = button('×', onClose); close.setAttribute('aria-label', '关闭插件');
  const reload = iconButton('刷新', 'refresh', () => refresh());reload.classList.add('pcm-snapshot-refresh');
  const heading=node('div','pcm-snapshot-heading');heading.append(title,reload);
  header.append(back, heading, theme, close);
  const context = node('details', 'pcm-snapshot-context');context.open=true;
  const contextTitle=node('summary','','当前设置'),contextBody=node('div','pcm-snapshot-context-body');context.append(contextTitle,contextBody);
  const toolbar = node('div', 'pcm-snapshot-toolbar');
  const save = button('＋ 保存当前设置', () => execute('save')); save.classList.add('pcm-snapshot-primary');
  const saveScope={preset:true,worlds:true,regex:true};
  const scopePicker=createSnapshotScopePicker(saveScope);
  const create=button('＋ 创建快照',()=>openEditor());create.classList.add('pcm-snapshot-create');toolbar.append(create);
  const notice = node('p', 'pcm-snapshot-notice', '快照可分别保存预设、全局世界书和正则设置。聊天绑定优先于角色绑定。');
  const status = node('p', 'pcm-snapshot-status'); status.setAttribute('role', 'status');
  const list = node('section', 'pcm-snapshot-list'); list.setAttribute('aria-label', '已保存快照');
  element.append(header, context, toolbar, notice, status, list);
  let data = null, busy = false, disposed = false, revision = 0, refreshPending = false, editor = null;
  const unsubscribe = host.on('snapshots-changed', () => {if (busy || editor) refreshPending = true; else void refresh();});

  function button(text, action) {
    const b = node('button', '', text); b.type = 'button';
    b.addEventListener('click', event => {event.stopPropagation(); action();});
    return b;
  }
  function iconButton(label, icon, action) {
    const b=button('',action);b.className='pcm-snapshot-icon';b.title=label;b.setAttribute('aria-label',label);
    const paths={refresh:'M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.5-1L20 9 M4 15l2.4 3A7 7 0 0 0 18 17',rename:'m14 5 5 5 M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z',delete:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7'};
    b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[icon]+'"/></svg>';
    return b;
  }
  function settingLine(label,value,cls='') {
    const row=node('div','pcm-snapshot-setting '+cls);row.append(node('span','pcm-snapshot-setting-label',label),node('span','pcm-snapshot-setting-value',value));return row;
  }
  function showStatus(message, error = false) {status.textContent = message; status.classList.toggle('is-error', error);}
  function setBusy(value) {
    busy = value;
    for (const b of element.querySelectorAll('button')) {
      if ([back, close, theme].includes(b)) continue;
      b.disabled = value || b.dataset.unavailable === 'true';
    }
    element.setAttribute('aria-busy', String(value));
    for (const input of scopePicker.querySelectorAll('input')) input.disabled=value;
  }
  function bindingName(id) {return data.snapshots.find(s => s.id === id)?.name || (id ? '快照已删除' : '未绑定');}
  function render() {
    if (disposed || !data) return;
    const expanded = new Set([...contextBody.querySelectorAll('details[open]')].map(d => d.dataset.regexScope));
    contextBody.replaceChildren(); list.replaceChildren();
    const c = data.context;
    const settings=node('div','pcm-snapshot-settings-grid');
    settings.append(settingLine('当前预设',c.presetName||'未选择','pcm-snapshot-current'),settingLine('当前角色',c.characterName),settingLine('当前聊天',c.chatName));
    for(const [scope,label] of [['global','全局世界书'],['character','角色附加世界书'],['chat','聊天附加世界书']])settings.append(settingLine(label,c.resources?.worlds?.[scope]?.join('、')||'未挂载'));
    contextBody.append(settings);
    const regex=node('div','pcm-snapshot-current-regex');regex.append(node('strong','','当前正则'));
    for(const [scope,label] of [['global','全局正则'],['preset','预设正则'],['character','角色正则']]) {
      const scripts=c.resources?.regex?.[scope]||[],details=node('details','pcm-snapshot-regex-details');details.dataset.regexScope=scope;details.open=expanded.has(scope);
      const summary=node('summary');summary.append(node('span','',label),node('span','pcm-snapshot-count',scripts.filter(s=>s.enabled).length+'/'+scripts.length+' 开启'));details.append(summary);
      const lines=node('div','pcm-snapshot-regex-choices');for(const script of scripts){const row=node('span','pcm-snapshot-read-switch'+(script.enabled?'':' is-off'));const sw=node('span','pcm-snapshot-switch-display');sw.setAttribute('role','img');sw.setAttribute('aria-label',script.enabled?'开启':'关闭');sw.dataset.enabled=String(script.enabled);row.append(sw,node('span','',script.name||script.id));lines.append(row);}if(!scripts.length)lines.append(node('small','','没有正则'));details.append(lines);regex.append(details);
    }contextBody.append(regex);
    for (const [target, label, id, allowed] of [['character','当前角色绑定的快照',c.characterBindingId,c.canBindCharacter],['chat','当前聊天绑定的快照',c.chatBindingId,c.canBindChat]]) {
      const row = node('div', 'pcm-snapshot-binding'); row.append(node('span', '', label),node('span','pcm-snapshot-badge',bindingName(id)));
      if (id && allowed) row.append(button('解除绑定', () => execute('unbind', {target})));
      contextBody.append(row);
    }
    const active = data.activeBinding;
    contextBody.append(node('small', '', active ? '进入聊天时应用：'+active.name+'（'+(active.source === 'chat' ? '聊天绑定' : '角色默认')+'）' : '当前没有自动绑定，手动切换即可。'));
    for(const warning of c.regexAuthorization||[])contextBody.append(node('small','',warning));
    const currentActions=node('div','pcm-snapshot-actions');currentActions.append(save);contextBody.append(scopePicker,currentActions);
    if (!data.snapshots.length) {
      const empty = node('div', 'pcm-snapshot-empty');
      empty.append(node('strong', '', '把常用设置存成一份快照'), node('p', '', '保存当前设置，或点击「创建快照」自由搭配。'));
      list.append(empty);
    }
    for (const snapshot of data.snapshots) {
      const card = node('article', 'pcm-snapshot-card'); card.dataset.snapshotId = snapshot.id;
      const top = node('div', 'pcm-snapshot-card-title'); top.append(node('h3', '', snapshot.name),iconButton('重命名','rename',()=>execute('rename',snapshot)),iconButton('删除','delete',()=>execute('delete',snapshot)));top.lastElementChild.classList.add('pcm-snapshot-delete');
      if (snapshot.id === c.chatBindingId || snapshot.id === c.characterBindingId) top.append(node('span', 'pcm-snapshot-badge', [snapshot.id === c.chatBindingId ? '此聊天' : '', snapshot.id === c.characterBindingId ? '此角色' : ''].filter(Boolean).join(' / ')));
      const books = snapshot.resources?.worlds?.global || snapshot.worldNames || [];
      const included=snapshotScope(snapshot);
      const summary = node('p', 'pcm-snapshot-summary', included.preset ? '当前预设：'+(snapshot.presetName || '无效预设') : '预设：保持当前');
      const mounts = node('p', 'pcm-snapshot-books', !included.worlds ? '全局世界书：保持当前' : books.length ? '全局世界书：'+books.join('、') : '全局世界书：不挂载');
      const range=node('p','pcm-snapshot-saved-scope','保存范围：'+Object.keys(snapshotScopeLabels).filter(key=>included[key]).map(key=>snapshotScopeLabels[key]).join('、'));
      const actions = node('div', 'pcm-snapshot-actions');
      const apply = button('应用', () => execute('apply', snapshot)); apply.classList.add('pcm-snapshot-primary');
      const chat = button('绑定此聊天', () => execute('bind', {...snapshot, target: 'chat'}));
      const character = button('绑定此角色', () => execute('bind', {...snapshot, target: 'character'}));
      chat.dataset.unavailable = String(!c.canBindChat); character.dataset.unavailable = String(!c.canBindCharacter);
      actions.append(apply, chat, character);
      const manage = node('div', 'pcm-snapshot-actions');
      manage.classList.add('pcm-snapshot-manage');manage.append(button('查看快照详情',()=>openEditor(snapshot.id)));
      card.append(top, range, summary, mounts);
      card.append(actions,manage);list.append(card);
    }
    setBusy(busy);
  }

  async function refresh() {
    if (disposed) return;
    if (busy || editor) {refreshPending = true; return;}
    const token = ++revision;
    setBusy(true);
    try {
      const result = await host.request('snapshot-list');
      if (disposed || token !== revision) return;
      data = result; render(); showStatus('');
    } catch (error) {if (!disposed) showStatus(error.message, true);}
    finally {
      if (!disposed && token === revision) {setBusy(false); if (refreshPending) {refreshPending = false; void refresh();}}
    }
  }

  function closeEditor(result) {
    editor?.destroy();editor=null;
    for(const part of [context,toolbar,notice,status,list])part.hidden=false;
    title.textContent='设置快照';back.textContent='← 首页';
    reload.hidden=false;
    if(result?.snapshots){data=result;refreshPending=false;render();showStatus('快照已保存');}
    else void refresh();
    element.closest('dialog')?.scrollTo(0,0);
  }
  async function openEditor(id) {
    if(busy||disposed||!data)return;
    setBusy(true);showStatus('正在读取快照配置…');
    try {
      const model=await host.request('snapshot-editor',{id,contextKey:data.context.key});
      if(disposed)return;
      editor=createSnapshotEditor({host,model,existingId:id,onCancel:()=>closeEditor(),onSaved:closeEditor,toast});
      for(const part of [context,toolbar,notice,status,list])part.hidden=true;
      title.textContent=id?'快照详情':'创建快照';reload.hidden=true;back.textContent='← 快照';element.append(editor.element);element.closest('dialog')?.scrollTo(0,0);
    }catch(error){if(!disposed){showStatus(error.message,true);toast.error(error.message);}}
    finally{if(!disposed)setBusy(false);}
  }

  async function execute(action, snapshot = {}) {
    if (busy || disposed || !data) return;
    const contextKey = data.context.key;
    setBusy(true);
    showStatus('');
    try {
      let result, message = '';
      if (action === 'save' || action === 'rename') {
        if (action==='save') snapshotScope({scope:saveScope});
        const name = await prompt(action === 'save' ? '给当前设置起个名字' : '快照名称', action === 'save' ? '' : snapshot.name);
        if (name === null || disposed) return;
        result = await host.request(action === 'save' ? 'snapshot-save' : 'snapshot-rename', {id: action === 'rename' ? snapshot.id : undefined, name, contextKey,scope:action==='save'?{...saveScope}:undefined});
        message = action === 'save' ? '快照已保存' : '名称已更新';
      } else if (action === 'update') {
        if (!(await confirm('用酒馆当前的开关和全局世界书更新「'+snapshot.name+'」？绑定这份快照的聊天和角色会使用更新后的设置。')) || disposed) return;
        result = await host.request('snapshot-save', {id: snapshot.id, name: snapshot.name, contextKey}); message = '快照已更新';
      } else if (action === 'delete') {
        if (!(await confirm('删除「'+snapshot.name+'」？它的聊天绑定将失效，角色绑定将解除。')) || disposed) return;
        result = await host.request('snapshot-delete', {id: snapshot.id}); message = '快照已删除';
      } else if (action === 'bind' || action === 'unbind') {
        result = await host.request('snapshot-bind', {id: action === 'unbind' ? null : snapshot.id, target: snapshot.target, contextKey});
        message = action === 'unbind' ? '已解除绑定，下次进入聊天时按剩余绑定应用' : '已绑定，下次进入聊天自动应用；现在可点击「应用」';
      } else if (action === 'apply') {
        result = await host.request('snapshot-apply', {id: snapshot.id, contextKey});
        if (result.needsConfirmation) {
          if (!(await confirm('缺少世界书：'+result.missingWorldNames.join('、')+'。继续应用预设开关和其余世界书？')) || disposed) return;
          result = await host.request('snapshot-apply', {id: snapshot.id, contextKey, allowMissingWorlds: true});
        }
        message = result.warnings?.length ? '已应用可恢复部分。'+result.warnings.join('；') : '已应用「'+snapshot.name+'」';
      }
      if (disposed) return;
      if (result?.snapshots) {data = result; render();}
      else {data = await host.request('snapshot-list'); if (!disposed) render();}
      if (disposed) return;
      refreshPending = false;
      showStatus(message, Boolean(result?.warnings?.length));
      if (result?.warnings?.length) toast.warning(message); else toast.success(message);
    } catch (error) {if (!disposed) {showStatus(error.message, true); toast.error(error.message);}}
    finally {if (!disposed) {setBusy(false); if (refreshPending) {refreshPending = false; void refresh();}}}
  }
  return {element, refresh, destroy() {disposed = true; revision++; unsubscribe(); editor?.destroy(); element.remove();}};
}
