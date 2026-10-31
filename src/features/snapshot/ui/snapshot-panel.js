// 设置快照页面：保存、恢复与聊天/角色绑定；区分保存失败与回读未确认，支持只读重新核验。
import { chooseApiSnapshotBinding } from '../../api/ui/api-snapshot-bind.js';
import { createSnapshotEditor } from './snapshot-editor.js';
import { createSnapshotReasoningForm } from './snapshot-reasoning-form.js';
import { snapshotScope, sortSnapshotFavorites } from '../snapshot.js';
import { createSnapshotScopePicker, snapshotScopeText } from './snapshot-scope.js';
// 搜索仅筛选展示，不修改快照或绑定。
export function searchSnapshotNames(snapshots,text){const query=String(text||'').trim().toLocaleLowerCase();return snapshots.filter(s=>String(s.name||'').toLocaleLowerCase().includes(query));}
export function createSnapshotPanel({host, onBack, onClose, onCycleTheme, themeIcon, prompt, confirm, toast, quick=false, onApi}) {
  const node = (tag, cls, text) => {const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n;};
  const element = node('main', 'pcm-snapshots pcm-api-manager pcm-snapshot-manager');
  element.setAttribute('aria-label', '设置快照');
  const header = node('header', 'pcm-snapshot-header');
  const back = iconButton('首页', 'home', () => editor ? closeEditor() : onBack()), title = node('h2', '', '设置快照');
  const theme = button('', onCycleTheme); theme.dataset.themeToggle = ''; theme.title = '切换配色'; theme.setAttribute('aria-label', '切换配色'); theme.innerHTML = themeIcon;
  const close = iconButton('关闭插件','close',onClose); close.setAttribute('aria-label', '关闭插件');
  const reload = iconButton('刷新', 'refresh', () => refresh());reload.classList.add('pcm-snapshot-refresh');
  const heading=node('div','pcm-snapshot-heading');heading.append(title,reload);
  const preferences=node('div','pcm-api-entry-settings'),toggles={};
  for(const [key,label] of [['quickReply','快速回复'],['floating','悬浮球']]){
    const toggle=button(label,async()=>{if(busy)return;setBusy(true);try{const next=await host.request('api-manager-preferences',{[key]:toggle.getAttribute('aria-pressed')!=='true'});for(const id of Object.keys(toggles))toggles[id].setAttribute('aria-pressed',String(!!next[id]));}catch(error){showStatus(error.message,true);}finally{setBusy(false);}});
    toggle.className='pcm-api-entry-toggle';toggle.setAttribute('aria-label','启用'+label);toggle.setAttribute('aria-pressed','false');toggles[key]=toggle;preferences.append(toggle);
  }
  if(!quick)header.append(back);header.append(heading,preferences,theme,close);
  const tabs=node('div','pcm-header-switch');if(onApi)tabs.append(button('API 管理',onApi));heading.append(tabs);
  if(quick)element.classList.add('pcm-api-quick');
  const context = node('details', 'pcm-snapshot-context');
  const contextTitle=node('summary',''),contextBody=node('div','pcm-snapshot-context-body');contextTitle.append(node('span','pcm-snapshot-context-label','当前设置'));context.append(contextTitle,contextBody);
  const toolbar = node('div', 'pcm-snapshot-toolbar');
  const save = button('＋ 保存当前设置', () => execute('save')); save.classList.add('pcm-snapshot-primary');
  save.addEventListener('click',event=>event.preventDefault());
  contextTitle.append(save);
  const saveScope={preset:true,worlds:true,regex:true,reasoning:true,presetRegex:true};
  const scopePicker=createSnapshotScopePicker(saveScope,()=>{},{currentPresetRegex:true});
  const create=button('＋ 创建快照',()=>openEditor());create.classList.add('pcm-snapshot-create');toolbar.append(create);
  const filters=node('div','pcm-snapshot-filters'),search=node('input','pcm-snapshot-search');search.type='search';search.placeholder='搜索快照名称';search.setAttribute('aria-label','搜索快照名称');search.addEventListener('input',()=>render());const clearSearch=button('清空搜索',()=>{search.value='';render();search.focus();});filters.append(search,clearSearch);
  const notice = node('p', 'pcm-snapshot-notice', '快照可分别保存预设、全局世界书、正则和推理设置。聊天绑定优先于角色绑定。');
  const status = node('p', 'pcm-snapshot-status'); status.setAttribute('role', 'status');
  const persistence = node('section', 'pcm-snapshot-persistence'); persistence.hidden = true;
  const persistenceText = node('p'); persistenceText.setAttribute('role', 'status');
  const verify = button('重新核验', () => verifyPersistence()); verify.dataset.snapshotVerify = '';
  persistence.append(persistenceText, verify);
  const list = node('section', 'pcm-snapshot-list'); list.setAttribute('aria-label', '已保存快照');
  element.append(header, context, toolbar, filters, notice, status, persistence, list);
  let data = null, busy = false, disposed = false, revision = 0, refreshPending = false, editor = null;
  // 收藏显示与持久化分开；同一快照等待核验，不锁住其它快照和搜索。
  const pendingFavorites = new Map();
  const lifetime = new AbortController();
  const unsubscribe = host.on('snapshots-changed', change => {
    if (change?.favoriteId && pendingFavorites.has(change.favoriteId)) return;
    if (busy || editor || pendingFavorites.size) refreshPending = true; else void refresh();
  });

  function button(text, action) {
    const b = node('button', '', text); b.type = 'button';
    b.addEventListener('click', event => {event.stopPropagation(); action();});
    return b;
  }
  function iconButton(label, icon, action) {
    const b=button('',action);b.className='pcm-snapshot-icon pcm-api-icon';b.title=label;b.setAttribute('aria-label',label);
    const paths={close:'m6 6 12 12M6 18 18 6',home:'m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',refresh:'M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.5-1L20 9 M4 15l2.4 3A7 7 0 0 0 18 17',rename:'m14 5 5 5 M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z',delete:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7'};
    b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[icon]+'"/></svg>';
    return b;
  }
  function settingLine(label,value,cls='') {
    const row=node('div','pcm-snapshot-setting '+cls);row.append(node('span','pcm-snapshot-setting-label',label),node('span','pcm-snapshot-setting-value',value));return row;
  }
  function showStatus(message, error = false) {status.textContent = message; status.classList.toggle('is-error', error);}
  function persistenceMessage(result = data) {
    return result?.persistence?.verified === false
      ? result.persistence.message || '保存请求已提交，但暂时无法确认保存结果。当前页面保留改动，请稍后重新核验，勿重复创建快照。'
      : '';
  }
  function renderPersistence() {
    const message = persistenceMessage();
    persistenceText.textContent = message;
    persistence.hidden = !!editor || !message;
    verify.disabled = busy || pendingFavorites.size > 0;
  }
  function reportResult(result, message, warning = false) {
    const pending = persistenceMessage(result);
    showStatus(pending ? '' : message, !pending && warning);
    if (pending) toast.warning(pending);
    else if (warning) toast.warning(message);
    else toast.success(message);
  }
  function setBusy(value) {
    busy = value;
    for (const b of element.querySelectorAll('button')) {
      if ([back, close, theme].includes(b)) continue;
      b.disabled = value || b.dataset.unavailable === 'true' || b.dataset.favoritePending === 'true';
    }
    element.setAttribute('aria-busy', String(value));
    for (const input of scopePicker.querySelectorAll('input')) input.disabled=value;
    verify.disabled = value || pendingFavorites.size > 0;
  }
  function bindingName(id) {return data.snapshots.find(s => s.id === id)?.name || (id ? '快照已删除' : '未绑定');}
  function favoriteValue(snapshot) {return pendingFavorites.get(snapshot.id)?.favorite ?? (snapshot.favorite === true);}
  function visibleSnapshots() {
    return sortSnapshotFavorites(searchSnapshotNames(data.snapshots,search.value).map(snapshot => ({...snapshot,favorite:favoriteValue(snapshot)})));
  }
  function updateFavoriteView() {
    if (disposed || !data) return;
    renderPersistence();
    const focused = document.activeElement, cards = new Map([...list.querySelectorAll('.pcm-snapshot-card')].map(card => [card.dataset.snapshotId,card]));
    for (const snapshot of data.snapshots) {
      const card=cards.get(snapshot.id);if(!card)continue;
      const favorite=card.querySelector('.pcm-snapshot-favorite'),saving=card.querySelector('.pcm-snapshot-favorite-status'),pending=pendingFavorites.has(snapshot.id),value=favoriteValue(snapshot);
      favorite.setAttribute('aria-pressed',String(value));favorite.setAttribute('aria-busy',String(pending));favorite.dataset.favoritePending=String(pending);
      favorite.title=value?'取消收藏置顶':'收藏置顶';favorite.setAttribute('aria-label',favorite.title);favorite.querySelector('svg').setAttribute('fill',value?'currentColor':'none');
      favorite.disabled=busy||pending;saving.hidden=!pending;saving.textContent=pending?(value?'正在保存收藏…':'正在取消收藏…'):'';
    }
    let next=list.firstElementChild;
    for(const snapshot of visibleSnapshots()){
      const card=cards.get(snapshot.id);if(!card)continue;
      if(card!==next)list.insertBefore(card,next);
      next=card.nextElementSibling;
    }
    if(focused?.isConnected&&list.contains(focused)&&!focused.disabled&&document.activeElement!==focused)focused.focus({preventScroll:true});
  }
  function render() {
    if (disposed || !data) return;
    const expanded = new Set([...contextBody.querySelectorAll('details[open]')].map(d => d.dataset.regexScope));
    contextBody.replaceChildren(); list.replaceChildren();
    const c = data.context;
    const settings=node('div','pcm-snapshot-settings-grid');
    settings.append(settingLine('当前预设',c.presetName||'未选择','pcm-snapshot-current'),settingLine('当前角色',c.characterName),settingLine('当前聊天',c.chatName));
    for(const [scope,label] of [['global','全局世界书'],['character','角色附加世界书'],['chat','聊天附加世界书']])settings.append(settingLine(label,c.resources?.worlds?.[scope]?.join('、')||'未挂载'));
    contextBody.append(settings);
    const regex=node('details','pcm-snapshot-current-regex pcm-snapshot-current-section');regex.dataset.regexScope='regex';regex.open=expanded.has('regex');regex.append(node('summary','','当前正则'));
    for(const [scope,label] of [['global','全局正则'],['preset','预设正则'],['character','角色正则']]) {
      const scripts=c.resources?.regex?.[scope]||[],details=node('details','pcm-snapshot-regex-details');details.dataset.regexScope=scope;details.open=expanded.has(scope);
      const summary=node('summary');summary.append(node('span','',label),node('span','pcm-snapshot-count',scripts.filter(s=>s.enabled).length+'/'+scripts.length+' 开启'));details.append(summary);
      const lines=node('div','pcm-snapshot-regex-choices');for(const script of scripts){const row=node('span','pcm-snapshot-read-switch'+(script.enabled?'':' is-off'));const sw=node('span','pcm-snapshot-switch-display');sw.setAttribute('role','img');sw.setAttribute('aria-label',script.enabled?'开启':'关闭');sw.dataset.enabled=String(script.enabled);row.append(sw,node('span','',script.name||script.id));lines.append(row);}if(!scripts.length)lines.append(node('small','','没有正则'));details.append(lines);regex.append(details);
    }contextBody.append(regex);
    const reasoning=node('details','pcm-snapshot-current-section');reasoning.dataset.regexScope='reasoning';reasoning.open=expanded.has('reasoning');reasoning.append(node('summary','','当前推理设置'));
    if(c.reasoning)reasoning.append(createSnapshotReasoningForm({value:{...c.reasoning},readOnly:true}).element);
    else reasoning.append(node('p','pcm-snapshot-notice',c.reasoningError||'推理设置尚未就绪'));
    contextBody.append(reasoning);
    for (const [target, label, id, allowed] of [['character','当前角色绑定的快照',c.characterBindingId,c.canBindCharacter],['chat','当前聊天绑定的快照',c.chatBindingId,c.canBindChat]]) {
      const row = node('div', 'pcm-snapshot-binding'); row.append(node('span', '', label),node('span','pcm-snapshot-badge',bindingName(id)));
      if (id && allowed) row.append(button('解除绑定', () => execute('unbind', {target})));
      contextBody.append(row);
    }
    const active = data.activeBinding;
    contextBody.append(node('small', '', active ? '进入聊天时应用：'+active.name+'（'+(active.source === 'chat' ? '聊天绑定' : '角色默认')+'）' : '当前没有自动绑定，手动切换即可。'));
    for(const warning of c.regexAuthorization||[])contextBody.append(node('small','',warning));
    contextBody.append(scopePicker);
    if (!data.snapshots.length) {
      const empty = node('div', 'pcm-snapshot-empty');
      empty.append(node('strong', '', '把常用设置存成一份快照'), node('p', '', '保存当前设置，或点击「创建快照」自由搭配。'));
      list.append(empty);
    }
    const visible=visibleSnapshots();
    if(data.snapshots.length&&!visible.length)list.append(node('p','pcm-snapshot-empty','没有匹配的快照，请修改名称关键词或清空搜索。'));
    for (const snapshot of visible) {
      const card = node('article', 'pcm-snapshot-card'); card.dataset.snapshotId = snapshot.id;
      const overwrite=button('覆',()=>execute('update',snapshot));overwrite.title='用当前设置覆盖快照';overwrite.setAttribute('aria-label',overwrite.title);
      const favorite=button('',()=>saveFavorite(snapshot.id));favorite.className='pcm-snapshot-icon pcm-snapshot-favorite';favorite.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.6l6.3-.9Z"/></svg>';
      const favoriteStatus=node('small','pcm-snapshot-favorite-status');favoriteStatus.setAttribute('role','status');
      const top = node('div', 'pcm-snapshot-card-title'); top.append(node('h3', '', snapshot.name),favorite,overwrite,iconButton('编辑快照详情','rename',()=>openEditor(snapshot.id)),iconButton('删除','delete',()=>execute('delete',snapshot)));top.lastElementChild.classList.add('pcm-snapshot-delete');
      if (snapshot.id === c.chatBindingId || snapshot.id === c.characterBindingId) top.append(node('span', 'pcm-snapshot-badge', [snapshot.id === c.chatBindingId ? '此聊天' : '', snapshot.id === c.characterBindingId ? '此角色' : ''].filter(Boolean).join(' / ')));
      const books = snapshot.resources?.worlds?.global || snapshot.worldNames || [];
      const included=snapshotScope(snapshot);
      const summary = node('p', 'pcm-snapshot-summary', included.preset ? '当前预设：'+(snapshot.presetName || '无效预设') : '预设：保持当前');
      const mounts = node('p', 'pcm-snapshot-books', !included.worlds ? '全局世界书：保持当前' : books.length ? '全局世界书：'+books.join('、') : '全局世界书：不挂载');
      const range=node('p','pcm-snapshot-saved-scope','保存范围：'+snapshotScopeText(included));
      const actions = node('div', 'pcm-snapshot-actions');
      const apply = button('切', () => execute('apply', snapshot)); apply.classList.add('pcm-snapshot-primary');
      const chat = button('绑定此聊天', () => execute('bind', {...snapshot, target: 'chat'}));
      const character = button('绑定此角色', () => execute('bind', {...snapshot, target: 'character'}));
      chat.dataset.unavailable = String(!c.canBindChat); character.dataset.unavailable = String(!c.canBindCharacter);
      top.append(apply);
      actions.append(button('绑定api',async()=>{try{await chooseApiSnapshotBinding({host,parent:element,snapshotId:snapshot.id});}catch(error){showStatus(error.message,true);}}), chat, character);
      card.append(top, favoriteStatus, range, summary, mounts);
      if(included.reasoning)card.append(node('p','pcm-snapshot-summary','推理设置：'+(snapshot.reasoning?.name||'自定义格式')+(snapshot.reasoning?.version===1?'（旧版解析绑定）':'')));
      card.append(actions);list.append(card);
    }
    updateFavoriteView();
    setBusy(busy);
  }

  async function refresh() {
    if (disposed) return;
    if (busy || editor || pendingFavorites.size) {refreshPending = true; return;}
    const token = ++revision;
    setBusy(true);
    try {
      const result = await host.request('snapshot-list');
      const prefs = await host.request('api-manager-links');
      for(const key of Object.keys(toggles))toggles[key].setAttribute('aria-pressed',String(!!prefs.preferences?.[key]));
      if (disposed || token !== revision) return;
      data = result; render(); showStatus('');
    } catch (error) {if (!disposed) showStatus(error.message, true);}
    finally {
      if (!disposed && token === revision) {setBusy(false); if (refreshPending) {refreshPending = false; void refresh();}}
    }
  }

  async function verifyPersistence() {
    if (busy || disposed || editor || pendingFavorites.size || !persistenceMessage()) return;
    setBusy(true); showStatus('正在核验保存结果…');
    try {
      // This action only reads the saved state; it must not resubmit or recreate snapshots.
      const result = await host.request('snapshot-verify');
      if (disposed) return;
      data = result; render(); refreshPending = false;
      reportResult(result, '快照改动已核验保存');
    } catch (error) {
      if (!disposed) {showStatus(error.message, true); toast.error(error.message);}
    } finally {
      if (!disposed) {setBusy(false); if (refreshPending) {refreshPending = false; void refresh();}}
    }
  }

  async function saveFavorite(id) {
    if (busy || disposed || !data || pendingFavorites.has(id)) return;
    const snapshot=data.snapshots.find(item=>item.id===id);if(!snapshot)return;
    const favorite=snapshot.favorite!==true;
    pendingFavorites.set(id,{favorite});updateFavoriteView();
    try {
      const result=await host.request('snapshot-favorite',{id,favorite});
      if(disposed)return;
      const confirmed=result?.snapshots?.find(item=>item.id===id);
      if(!confirmed||(confirmed.favorite===true)!==favorite)throw new Error('收藏保存状态未确认，请刷新列表核对');
      // 只接纳本次收藏状态，不能用较早响应覆盖并行编辑、删除或聊天上下文。
      data.snapshots=data.snapshots.map(item=>{
        if(item.id!==id)return item;
        const next={...item};if(favorite)next.favorite=true;else delete next.favorite;return next;
      });
      // A partial response for this favorite must not hide another in-flight operation's warning.
      if (result.persistence?.verified === false) data.persistence = result.persistence;
      else if (!busy && !editor && pendingFavorites.size === 1) delete data.persistence;
      renderPersistence();
      const message=favorite?'已收藏并置顶':'已取消收藏置顶';
      if(!busy&&!editor)reportResult(result,message);
      else if(persistenceMessage(result))toast.warning(persistenceMessage(result));
      else toast.success(message);
    } catch(error) {
      if(!disposed){if(!busy&&!editor)showStatus(error.message,true);toast.error(error.message);}
    } finally {
      pendingFavorites.delete(id);
      if(!disposed){
        updateFavoriteView();
        if(refreshPending&&!pendingFavorites.size&&!busy&&!editor){refreshPending=false;void refresh();}
      }
    }
  }

  function closeEditor(result) {
    editor?.destroy();editor=null;
    for(const part of [context,toolbar,filters,notice,status,list])part.hidden=false;
    title.textContent='设置快照';back.innerHTML=iconButton('首页','home',()=>{}).innerHTML;
    reload.hidden=false;
    if(result?.snapshots){data=result;if(!pendingFavorites.size)refreshPending=false;render();showStatus(persistenceMessage(result)?'':'快照已保存');}
    else {renderPersistence();void refresh();}
    element.closest('dialog')?.scrollTo(0,0);
  }
  async function openEditor(id) {
    if(busy||disposed||!data)return;
    setBusy(true);showStatus('正在读取快照配置…');
    try {
      const model=await host.request('snapshot-editor',{id,contextKey:data.context.key});
      if(disposed)return;
      editor=createSnapshotEditor({host,model,existingId:id,onCancel:()=>closeEditor(),onSaved:closeEditor,toast,prompt,confirm});
      for(const part of [context,toolbar,filters,notice,status,persistence,list])part.hidden=true;
      title.textContent=id?'快照详情':'创建快照';reload.hidden=true;back.innerHTML='←';element.append(editor.element);element.closest('dialog')?.scrollTo(0,0);
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
        const scope=snapshotScope(snapshot),range=snapshotScopeText(scope);
        if (!(await confirm('用酒馆当前设置覆盖「'+snapshot.name+'」？\n覆盖范围：'+range+'。\n保留方案名称和绑定关系；绑定此方案的聊天和角色以后会使用覆盖后的设置。')) || disposed) return;
        result = await host.request('snapshot-save', {id: snapshot.id, name: snapshot.name, contextKey,scope}); message = '快照已覆盖';
      } else if (action === 'delete') {
        if (!(await confirm('删除「'+snapshot.name+'」？它的聊天绑定将失效，角色绑定将解除。')) || disposed) return;
        result = await host.request('snapshot-delete', {id: snapshot.id}); message = '快照已删除';
      } else if (action === 'bind' || action === 'unbind') {
        result = await host.request('snapshot-bind', {id: action === 'unbind' ? null : snapshot.id, target: snapshot.target, contextKey});
        message = action === 'unbind' ? '已解除绑定，下次进入聊天时按剩余绑定应用' : '已绑定，下次进入聊天自动应用；现在可点击「切」';
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
      if(!pendingFavorites.size)refreshPending = false;
      reportResult(result, message, Boolean(result?.warnings?.length));
    } catch (error) {if (!disposed) {showStatus(error.message, true); toast.error(error.message);}}
    finally {if (!disposed) {setBusy(false); if (refreshPending) {refreshPending = false; void refresh();}}}
  }
  return {element, refresh, destroy() {disposed = true; lifetime.abort(); revision++; unsubscribe(); editor?.destroy(); element.remove();}};
}
