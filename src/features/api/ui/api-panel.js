// API 管理页面：方案编辑、酒馆原生方案导入与独立切换，所有宿主操作均通过通信桥。
import { editApiAdditional } from './api-additional.js';
import { chooseNativeApiProfiles } from './api-native-import.js';
import { chooseApiSnapshotBinding } from './api-snapshot-bind.js';
export function createApiPanel({ host, onBack, onClose, onCycleTheme, themeIcon, prompt, confirm, quick = false, onSnapshots }) {
  const node = (tag, cls, text) => { const el = document.createElement(tag); el.className = cls || ''; if (text !== undefined) el.textContent = text; return el; };
  const element = node('main', 'pcm-snapshots pcm-api-manager');
  element.setAttribute('aria-label', quick ? 'API 快切' : 'API 管理'); if(quick) element.classList.add('pcm-api-quick');
  let data, busy = false, disposed = false, editing = null;
  function button(label, action) { const b = node('button', '', label); b.type = 'button'; b.addEventListener('click', event => { event.stopPropagation(); void action(); }); return b; }
  const header = node('header', 'pcm-snapshot-header');
  const heading = node('div', 'pcm-snapshot-heading'); heading.append(node('h2', '', quick ? 'API 快切' : 'API 管理'));
  function iconButton(label, path, action) {
    const b = button('', action); b.className = 'pcm-api-icon'; b.title = label; b.setAttribute('aria-label', label);
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>'; return b;
  }
  const refreshPath = 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17';
  heading.append(iconButton('刷新当前设置', refreshPath, () => run(refresh)));
  const theme = button('', onCycleTheme); theme.innerHTML = themeIcon; theme.dataset.themeToggle = ''; theme.setAttribute('aria-label', '切换配色');
  if(!quick) header.append(iconButton('首页', 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9', onBack));
  const current = node('section', 'pcm-snapshot-context pcm-api-current'); current.setAttribute('aria-label', '当前设置');
  const toolbar = node('div', 'pcm-snapshot-toolbar');
  const preferences = node('div','pcm-api-entry-settings');
  const checks = {};
  for (const [key, labelText, text] of [['quickReply', '启用快速回复', '快速回复'], ['floating', '启用悬浮球', '悬浮球']]) {
    const toggle = button(text, () => run(async () => {
      try { await host.request('api-manager-preferences', { [key]: !data.preferences?.[key] }); }
      finally { await refresh(); }
    }));
    toggle.className = 'pcm-api-entry-toggle'; toggle.setAttribute('aria-label', labelText);
    toggle.setAttribute('aria-pressed', 'false'); checks[key] = toggle; preferences.append(toggle);
  }
  header.append(heading, preferences, theme, iconButton('关闭插件','m6 6 12 12M6 18 18 6',onClose));
  const status = node('p', 'pcm-snapshot-status'); status.setAttribute('role', 'status');
  const list = node('section', 'pcm-snapshot-list');
  const modal = node('dialog', 'pcm-api-modal'); modal.setAttribute('aria-label', 'API 方案编辑');
  const editor = node('div', 'pcm-api-editor'); editor.hidden = true; modal.append(editor);
  const closeEditor = () => { if (busy) return; modal.close(); editor.hidden = true; editor.replaceChildren(); editing = null; };
  modal.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  const saveCurrent = button('保存当前设置', () => run(async () => {
    const name = await prompt('为当前 API 和模型起个名称', '我的 API'); if (!name) return;
    await host.request('api-manager-save', { capture: true, name }); await refresh(); message('已保存当前连接');
  }));
  toolbar.append(button('＋ 新建方案', () => edit()), button('酒馆api方案', () => run(async () => {
    const count = await chooseNativeApiProfiles({ host, parent: element });
    if (count) { await refresh(); message('已导入 ' + count + ' 个酒馆方案'); }
  })));
  const tabs = node('div','pcm-header-switch');
  if (onSnapshots) {tabs.append(button('设置快照',onSnapshots));}
  heading.append(tabs);
  element.append(header, current, toolbar,
    status, modal, list);
  function message(text, error = false) { if (disposed) return; const target = modal.open ? editor.querySelector('.pcm-api-editor-status') : status; if (target) { target.textContent = text; target.classList.toggle('is-error', error); } }
  function lock(value) { busy = value; element.setAttribute('aria-busy', String(value)); for (const el of element.querySelectorAll('button,input,select')) el.disabled = value; }
  async function run(task) { if (busy || disposed) return; lock(true); try { await task(); } catch (error) { message(error.message || '操作失败', true); } finally { if (!disposed) lock(false); } }
  async function refresh() { const next = await host.request('api-manager-list'); if (disposed) return; data = next; render(); }
  function connectionLine(profile) {
    const url = profile.connection.custom_url || '';
    let address = url;
    try { address = new URL(url).host; } catch {}
    const line = node('p', 'pcm-api-connection-line', (address || '未填写 URL') + ' / ' + (profile.model || '未选择模型'));
    line.title = url + ' / ' + (profile.model || ''); return line;
  }
  function render() {
    for(const key of Object.keys(checks)) { checks[key].setAttribute('aria-pressed', String(!!data.preferences?.[key])); checks[key].title = (data.preferences?.[key] ? '关闭' : '启用') + (key === 'quickReply' ? '快速回复' : '悬浮球'); }
    const currentHead = node('div', 'pcm-api-current-head'); currentHead.append(node('strong', '', '当前设置'), saveCurrent);
    current.replaceChildren(currentHead);
    if (data.supported) current.append(connectionLine(data.current));
    else current.append(node('p', '', '请先在酒馆选择“聊天补全 → 自定义（兼容 OpenAI）”'));
    list.replaceChildren();
    if (!data.profiles.length) list.append(node('p', 'pcm-snapshot-empty', '还没有方案。新建一个，或保存酒馆当前连接。'));
    for (const profile of data.profiles) {
      const card = node('article', 'pcm-snapshot-card pcm-api-profile'), actions = node('div', 'pcm-api-profile-actions');
      card.classList.toggle('is-active', data.activeIds?.includes(profile.id));
      const top = node('div', 'pcm-api-profile-head'); top.append(node('h3', '', profile.name), actions);
      if(data.activeIds?.includes(profile.id)) top.querySelector('h3').append(node('span','pcm-api-active-badge','已启用'));
      if(data.links?.some(link=>link.apiId===profile.id)) card.title='已绑定设置快照';
      const cut = button('切', () => run(async () => { let result = await host.request('api-manager-apply', {id:profile.id,mode:'both'}); if(result.needsConfirmation){if(!await confirm('绑定快照缺少世界书：'+result.missingWorldNames.join('、')+'。继续应用其余部分？'))return;result=await host.request('api-manager-apply',{id:profile.id,mode:'both',allowMissingWorlds:true});} await refresh(); message('已切换至：'+profile.name+'。'+result.connection.message+(result.warnings?.length?'；'+result.warnings.join('；'):''), !result.connection.ok); })); cut.title='切换至此方案';
      const overwrite = button('覆', () => run(async () => {
        if(!await confirm('用当前 URL、密钥和模型覆盖“'+profile.name+'”？')) return;
        await host.request('api-manager-save',{capture:true,id:profile.id,name:profile.name}); await refresh(); message('已覆盖方案');
      })); overwrite.title='用当前设置覆盖此方案';
      actions.append(cut, button('绑',()=>run(async()=>{await chooseApiSnapshotBinding({host,parent:element,apiId:profile.id});await refresh();})), overwrite, iconButton('编辑方案', 'm14 5 5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16l-1 4Z',()=>edit(profile)),iconButton('删除方案','M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',()=>run(async()=>{if(!await confirm('删除方案“'+profile.name+'”？'))return;await host.request('api-manager-delete',{id:profile.id});await refresh();})));
      card.append(top, connectionLine(profile)); list.append(card);

    }
  }
  function field(label, value = '', type = 'text') {
    const wrap = node('label', 'pcm-api-field'), input = node('input'); input.type = type; input.setAttribute('aria-label', label); input.value = value; input.autocomplete = 'off'; wrap.append(node('span', '', label), input); editor.append(wrap); return input;
  }
  function edit(profile = null) {
    if (!data || busy) return;
    let additional = profile ? profile.additional : {custom_include_body:'',custom_exclude_body:'',custom_include_headers:''};
    editing = profile; editor.replaceChildren(); editor.hidden = false;
    const editorHead = node('header', 'pcm-api-editor-head'); editorHead.append(node('h3', '', profile ? '编辑 API' : '创建 API'), iconButton('关闭编辑', 'm6 6 12 12M6 18 18 6', closeEditor)); editor.append(editorHead);
    const name = field('方案名称', profile?.name); name.required = true; name.maxLength = 100;
    const url = field('API 地址', profile?.connection.custom_url || '', 'url'); url.placeholder = 'https://example.com/v1'; url.required = true;

    // Keep the vault reference until the user replaces the masked field; never submit the mask as a key.
    const savedId = profile?.secretId || '';
    const masked = savedId ? (data.keys.find(key => key.id === savedId)?.masked || '••••••••') : '';
    const secret = field('密钥', masked, 'text'); secret.autocomplete = 'off'; secret.classList.add('pcm-api-secret-text'); secret.setAttribute('data-lpignore','true'); secret.setAttribute('data-1p-ignore','true'); secret.spellcheck=false;
    secret.placeholder = '输入 API 密钥（可留空）';
    secret.addEventListener('focus', () => { if (secret.value === masked) secret.select(); });
    const credentials = () => secret.value === masked
      ? { secretId: savedId, newSecret: '' }
      : { secretId: '', newSecret: secret.value.trim() };
    const model = field('默认模型', profile?.model || ''); model.required = true; model.placeholder = '搜索或输入中转站模型名称';
    const modelRow = node('div', 'pcm-api-input-row'); model.replaceWith(modelRow); modelRow.append(model);
    const modelMenu = node('div', 'pcm-api-model-menu'); modelMenu.hidden = true; modelMenu.setAttribute('role', 'group'); modelMenu.setAttribute('aria-label', '可用模型');
    let models = [];
    const renderModels = () => {
      modelMenu.replaceChildren(); modelMenu.hidden = !models.length;
      const matches = models.filter(value => value.toLowerCase().includes(model.value.toLowerCase()));
      for (const value of matches) modelMenu.append(button(value, () => { model.value = value; modelMenu.hidden = true; }));
      if (!matches.length) modelMenu.append(node('p', '', '没有匹配模型，可直接手动填写'));
    };
    model.addEventListener('input', renderModels); model.addEventListener('focus', renderModels);
    modelRow.append(iconButton('拉取模型', refreshPath, () => run(async () => {
      models = await host.request('api-manager-models', { url: url.value.trim(), ...credentials(), additional });
      renderModels(); message(models.length ? '已拉取 '+models.length+' 个模型，点击选择或搜索' : '未返回模型，可手动填写');
    })));
    modelRow.parentElement.append(modelMenu);
    const clearModels = () => { models = []; modelMenu.hidden = true; modelMenu.replaceChildren(); };
    url.addEventListener('input', clearModels); secret.addEventListener('input', clearModels);
    const editorStatus = node('p', 'pcm-api-editor-status'); editorStatus.setAttribute('role', 'status'); editor.append(editorStatus);
    const actions = node('div', 'pcm-snapshot-actions');
    const extra = button('附加参数', async () => { const next = await editApiAdditional({parent:element,value:additional}); if(next !== null) {additional=next;clearModels();} }); extra.style.marginRight='auto'; actions.append(extra);
    const save = node('button', '', '保存方案'); save.type = 'button'; actions.append(save, button('取消', closeEditor)); editor.append(actions);
    save.onclick = event => { event.preventDefault(); if (![name,url,model].every(input=>input.reportValidity())) return; void run(async () => {
      await host.request('api-manager-save', { profile: { id: editing?.id, name: name.value, source: 'custom', model: model.value, connection: { custom_url: url.value }, secretId: credentials().secretId, additional }, newSecret: credentials().newSecret });
      secret.value = ''; modal.close(); editor.hidden = true; editor.replaceChildren(); editing = null; await refresh(); message('方案已保存，当前连接保持原样');
    }); };
    modal.showModal(); name.focus();
  }
  return { element, refresh: () => run(refresh), destroy() { disposed = true; editor.replaceChildren(); element.remove(); } };
}
