// 预设更新编辑器 · 酒馆宿主桥：与 host/ 下原生列表适配共同封装主 document/API。
import { installNativeGroups } from './native-groups.js';
import { clone } from '../shared/clone.js';
import { API_BINDINGS_KEY, bindApiSnapshot, isApiProfileActive } from '../features/api/api-bindings.js';
// 扩展菜单入口、外层 dialog/iframe 外壳、preset-manager/openai 动态读取与保存、
// PRESET_CHANGED 订阅转发、主题变量与 TauriTavern IME 高度转发。
import { applyPresetToMemory, shouldRefreshActivePreset } from '../features/preset/core.js';
import { captureSnapshot, normalizeSnapshotName, planSnapshotRestore, resolveSnapshotBinding, snapshotOrder, validateSnapshot, snapshotPresetEditor, snapshotScope, selectSnapshotScope } from '../features/snapshot/snapshot.js';
import { captureWorldEntries, restoreWorldEntries, captureRegexSwitches, restoreRegexSwitches, validateSnapshotResources, normalizeSnapshotResources, regexEditor } from '../features/snapshot/snapshot-resources.js';
import { createIdentifier } from '../features/preset/core.js';
import { normalizeWorkbenchBook } from '../features/worldbook/worldbook-workbench.js';
import { API_STORE_KEY, API_ADDITIONAL_FIELDS, normalizeApiAdditional, normalizeApiProfile, planApiSwitch, readNativeApiProfiles, maskApiSecret } from '../features/api/api-manager.js';

// Track native worldbook writes from module startup, not only after a workbench window opens.
// Other URLs, the fetch receiver/arguments, and the exact returned Promise are left untouched.
const workbenchWorldWrites = installWorkbenchWorldWriteGuard();

function installWorkbenchWorldWriteGuard() {
  const original = globalThis.fetch;
  const state = {pending: new Set(), uncertain: false, fetch: null, version: 0};
  function guardedFetch(...args) {
    let tracked = false;
    try {
      const input = args[0], url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      tracked = url.origin === location.origin && url.pathname === '/api/worldinfo/edit';
    } catch { /* Native fetch owns input validation and its original error behavior. */ }
    if (!tracked) return Reflect.apply(original, this, args);
    state.version++;
    let finish;
    const pending = new Promise(resolve => {finish = resolve;});
    state.pending.add(pending);
    const done = () => {state.pending.delete(pending); finish();};
    let request;
    try {request = Reflect.apply(original, this, args);}
    catch (error) {state.uncertain = true; done(); throw error;}
    // A network error/abort has no confirmed server completion. Keep future overwrites blocked until reload.
    Promise.resolve(request).then(response => response.clone().arrayBuffer()).catch(() => {state.uncertain = true;}).then(done);
    return request;
  }
  state.fetch = guardedFetch;
  globalThis.fetch = guardedFetch;
  return state;
}

async function awaitWorkbenchWorldWrites() {
  if (globalThis.fetch !== workbenchWorldWrites.fetch) throw new Error('世界书保存请求追踪已被其他扩展替换，请刷新酒馆后重试');
  await withSnapshotTimeout((async () => {
    while (workbenchWorldWrites.pending.size) await Promise.all([...workbenchWorldWrites.pending]);
  })(), '原生世界书仍在保存，尚未覆盖写入；请等待完成后重试');
  if (workbenchWorldWrites.uncertain) throw new Error('有世界书写入请求异常，无法确认服务器已完成保存；请核对数据并刷新酒馆后重试');
}

async function stableWorkbenchWorldRead(read) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await awaitWorkbenchWorldWrites();
    const version = workbenchWorldWrites.version;
    const value = await read();
    // A native POST can start while the GET is in flight. Drain it and repeat the GET before trusting it.
    if (version === workbenchWorldWrites.version && globalThis.fetch === workbenchWorldWrites.fetch && !workbenchWorldWrites.uncertain) return value;
  }
  throw new Error('原生世界书持续发生写入，无法取得稳定数据；请稍后重试');
}

const APP_ID = 'preset-compare-migrator';
let nativeGroupController = null;
const APP_TITLE = '预设更新编辑器';
// SillyTavern is the canonical host. TauriTavern integration is optional and
// lives behind runtime detection so the standard web path has no Tauri dependency.
const CONNECT_MESSAGE = `${APP_ID}:connect`;
const POST_MESSAGE_TARGET = location.origin === 'null' ? '*' : location.origin;
const THEME_VARIABLES = [
  '--SmartThemeBorderColor',
  '--SmartThemeBlurTintColor',
  '--SmartThemeBodyColor',
  '--mainFontFamily',
  '--monoFontFamily',
];



function readPresetByName(manager, name) {
  const { presets, preset_names: names } = manager.getPresetList();
  let index = -1;
  if (Array.isArray(names)) index = names.indexOf(name);
  else if (names && typeof names === 'object' && names[name] !== undefined) index = Number(names[name]);
  return index >= 0 && index < presets.length ? presets[index] : null;
}

async function getPresetManager() {
  const module = await import('/scripts/preset-manager.js');
  const manager = module.getPresetManager?.('openai');
  if (!manager) throw new Error('当前酒馆版本未提供 OpenAI 预设管理接口');
  return manager;
}

async function listTavernPresets() {
  const candidates = new Map();
  const add = (name, preset) => {
    if (preset && Array.isArray(preset.prompts)) candidates.set(String(name || '未命名预设'), clone(preset));
  };
  const module = await import('/scripts/openai.js');
  const names = module.openai_setting_names || {};
  const settings = module.openai_settings || [];
  if (Array.isArray(names)) names.forEach((name, index) => add(name, settings[index]));
  else Object.entries(names).forEach(([name, index]) => add(name, settings[Number(index)]));
  return [...candidates.entries()];
}

async function handleRequest(method, payload) {
  if (method === 'api-manager-apply' && payload?.mode === 'both') return snapshotSerial(async () => {
    const {extension_settings} = await import('/scripts/extensions.js');
    const link = (extension_settings[API_BINDINGS_KEY] || []).find(item => item.apiId === payload.id);
    if (!link) return handleApiManagerRequest(method, payload);
    const env = await snapshotEnvironment();
    const snapshot = snapshotStore(env).snapshots.find(item => item.id === link.snapshotId);
    if (!snapshot) throw new Error('绑定快照已删除，请取消绑定后重试');
    return applyLinkedSnapshot(env, snapshot, {...payload, contextKey:snapshotContext(env).key}, false);
  });
  if (method.startsWith('api-manager-')) return snapshotSerial(() => handleApiManagerRequest(method, payload || {}), !['api-manager-native-list','api-manager-list','api-manager-links','api-manager-models','api-manager-preflight'].includes(method));
  if (method === 'workbench-read-worldbook' || method === 'workbench-save-worldbook') {
    // Share the resource queue with snapshot writes so the two features cannot overwrite each other.
    return snapshotSerial(() => handleWorkbenchWorldbook(method, payload || {}));
  }
  if (method.startsWith('snapshot-')) return handleSnapshotRequest(method, payload || {});
  if (method === 'list-worldbooks' || method === 'read-worldbook') {
    const module = await import('/scripts/world-info.js');
    const names = Array.isArray(module.world_names) ? module.world_names : [];
    if (method === 'list-worldbooks') return [...names];
    const name = String(payload?.name || '');
    if (!names.includes(name)) throw new Error('该世界书不存在，请重新读取列表');
    if (typeof module.loadWorldInfo !== 'function') throw new Error('当前酒馆不支持读取世界书，请导入世界书 JSON');
    const data = await module.loadWorldInfo(name);
    if (!data?.entries) throw new Error('世界书读取失败，请重试或导入世界书 JSON');
    return clone(data);
  }
  if (method === 'list-presets') return listTavernPresets();
  if (method === 'read-preset') {
    const manager = await getPresetManager();
    return clone(readPresetByName(manager, String(payload?.name || '')));
  }
  if (method === 'save-preset') {
    const name = String(payload?.name || '');
    const preset = payload?.preset;
    if (!name || !preset || !Array.isArray(preset.prompts)) throw new Error('预设名称或数据无效');
    const manager = await getPresetManager();
    const saved = clone(preset);
    // 先看原生酒馆预设管理器当前选中的预设：同名才走 savePreset 的「重新应用刷新」路径
    // （updateList 会重选该项并触发 change → 重载生成设置并发出 PRESET_CHANGED）；
    // 不同名则用 skipUpdate 静默写盘，避免酒馆把活动预设切到被保存的预设，
    // 再手动把内存中的预设数据同步为 saved（updateList 被跳过，与 ST 自身 writePresetExtensionField 的用法一致）。
    const activeName = typeof manager.getSelectedPresetName === 'function'
      ? String(manager.getSelectedPresetName() || '') : '';
    if (shouldRefreshActivePreset(activeName, name)) {
      await manager.savePreset(name, saved);
    } else {
      await manager.savePreset(name, saved, { skipUpdate: true });
      const { presets, preset_names: names } = manager.getPresetList();
      applyPresetToMemory(presets, names, name, saved);
    }
    return clone(readPresetByName(manager, name));
  }
  throw new Error(`未知宿主请求：${method}`);
}

async function handleApiManagerRequest(method, payload) {
  const [openai, script, extensions, secrets] = await Promise.all([
    import('/scripts/openai.js'), import('/script.js'), import('/scripts/extensions.js'), import('/scripts/secrets.js'),
  ]);
  const settings = openai.oai_settings;
  const store = extensions.extension_settings[API_STORE_KEY] ?? { version: 1, profiles: [] };
  if (store.version !== 1 || !Array.isArray(store.profiles)) throw new Error('API 方案库格式不受支持，请更新插件');
  const key = 'api_key_custom';
  const post = async (action, body) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`/api/secrets/${action}`, { method: 'POST', headers: script.getRequestHeaders(), body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new Error(`密钥管理请求失败（${response.status}），请核对酒馆密钥管理器`);
      return action === 'read' || action === 'write' ? await response.json() : null;
    } finally { clearTimeout(timer); }
  };
  const readKeys = async () => {
    const state = await post('read', {});
    const list = state[key];
    if (list != null && !Array.isArray(list)) throw new Error('当前酒馆不支持多密钥管理，请升级酒馆');
    // Never return the value field: it may be unmasked when the server allows key exposure.
    return (list || []).map(item => ({ id: item.id, label: item.label, active: !!item.active, masked: maskApiSecret(item.value) }));
  };
  const activeId = list => list.find(item => item.active)?.id || '';
  let generationLocked = false;
  const idle = () => {
    if (generationLocked) return;
    if (script.isGenerating?.() || script.is_send_press) throw new Error('正在生成，请结束生成后再操作 API');
  };
  const lockGeneration = () => {
    idle();
    if (typeof script.setSendButtonState !== 'function') throw new Error('当前酒馆缺少生成保护接口，请更新酒馆');
    script.setSendButtonState(true); generationLocked = true;
  };
  const unlockGeneration = () => { if (generationLocked) { script.setSendButtonState(false); generationLocked = false; } };
  const ready = () => {
    idle();
    if (script.main_api !== 'openai' || settings.chat_completion_source !== 'custom') throw new Error('第一版支持自定义兼容 API，请先在酒馆选择“聊天补全 → 自定义（兼容 OpenAI）”');
  };
  const rotate = async id => {
    await post('rotate', { key, id });
    if (activeId(await readKeys()) !== id) throw new Error('密钥切换未生效，请检查密钥是否已被删除');
    await secrets.readSecretState();
    if (Array.isArray(secrets.secret_state?.[key]) && activeId(secrets.secret_state[key]) !== id) throw new Error('原生密钥显示未同步，请刷新后核对');
  };
  const persist = async profiles => {
    extensions.extension_settings[API_STORE_KEY] = { version: 1, profiles };
    script.saveSettingsDebounced();
  };
  if (method === 'api-manager-links') {
    const snapshots = extensions.extension_settings[SNAPSHOT_KEY]?.snapshots || [];
    return {preferences:clone(extensions.extension_settings.preset_compare_api_entries || {}), links:clone(extensions.extension_settings[API_BINDINGS_KEY] || []), snapshots:snapshots.map(({id,name})=>({id,name})), profiles:store.profiles.map(({id,name})=>({id,name}))};
  }
  if (method === 'api-manager-bind') {
    const links = extensions.extension_settings[API_BINDINGS_KEY] || [];
    let next;
    if (payload.cancel) next = links.filter(link => payload.apiId ? link.apiId !== payload.apiId : link.snapshotId !== payload.snapshotId);
    else {
      if (!store.profiles.some(item=>item.id===payload.apiId)) throw new Error('API 方案已删除');
      if (!(extensions.extension_settings[SNAPSHOT_KEY]?.snapshots || []).some(item=>item.id===payload.snapshotId)) throw new Error('快照已删除');
      next = bindApiSnapshot(links, payload.apiId, payload.snapshotId);
    }
    extensions.extension_settings[API_BINDINGS_KEY] = next; script.saveSettingsDebounced(); return {links:clone(next)};
  }
  if(method==='api-manager-preferences'){
    const old=extensions.extension_settings.preset_compare_api_entries||{};
    const next={quickReply:!!old.quickReply,floating:!!old.floating};
    for(const key of ['quickReply','floating']) if(typeof payload[key]==='boolean')next[key]=payload[key];
    extensions.extension_settings.preset_compare_api_entries=next;script.saveSettingsDebounced();apiEntrySync?.(next);return next;
  }
  const current = keys => ({ source: settings.chat_completion_source, model: settings.custom_model || '', connection: { custom_url: settings.custom_url || '' }, additional: normalizeApiAdditional(settings), secretId: activeId(keys) });
  if (method === 'api-manager-models') {
    const profile = normalizeApiProfile({ name: '模型查询', model: 'query', connection: { custom_url: payload.url } });
    const body = { chat_completion_source: 'openai', reverse_proxy: profile.connection.custom_url, proxy_password: String(payload.newSecret || ''), custom_include_headers: payload.additional === undefined ? '' : normalizeApiAdditional(payload.additional).custom_include_headers };
    if (!payload.newSecret && payload.secretId) {
      if (!(await readKeys()).some(item => item.id === payload.secretId)) throw new Error('所选密钥已不存在，请重新选择');
      // Native /status can address a vault entry without rotating the active key or exposing its value.
      delete body.reverse_proxy; delete body.proxy_password;
      Object.assign(body, { chat_completion_source: 'custom', custom_url: profile.connection.custom_url, secret_id: String(payload.secretId) });
    }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/backends/chat-completions/status', { method: 'POST', headers: script.getRequestHeaders(), body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new Error(`拉取模型失败（${response.status}），请检查地址和密钥`);
      const result = await response.json(), models = result?.data ?? result?.models;
      if (!Array.isArray(models) || result?.error) throw new Error('未取得模型列表，请检查地址和密钥，或手动填写模型名称');
      return [...new Set(models.map(item => typeof item === 'string' ? item : item?.id).filter(item => typeof item === 'string' && item.length > 0 && item.length <= 500))].sort();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('拉取模型超时，请重试或手动填写');
      if (error instanceof TypeError) throw new Error('拉取模型网络失败，请检查连接');
      throw error;
    } finally { clearTimeout(timer); }
  }
  if (method === 'api-manager-list') {
    const keys = await readKeys();
    return { preferences: clone(extensions.extension_settings.preset_compare_api_entries || {}), profiles: clone(store.profiles), activeIds:store.profiles.filter(profile=>isApiProfileActive(profile,current(keys))).map(profile=>profile.id), links:clone(extensions.extension_settings[API_BINDINGS_KEY] || []), keys, current: current(keys), supported: script.main_api === 'openai' && settings.chat_completion_source === 'custom' };
  }
  if (method === 'api-manager-native-list' || method === 'api-manager-native-import') {
    const entries = readNativeApiProfiles(extensions.extension_settings.connectionManager?.profiles ?? [], await readKeys());
    if (method === 'api-manager-native-list') return entries;
    if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 500) throw new Error('请选择要导入的酒馆方案（最多 500 个）');
    const selected = [...new Set(payload.ids)].map(id => {
      const entry = entries.find(item => item.id === id);
      if (!entry || entry.error) throw new Error('酒馆方案已改变或无法导入，请重新打开列表：' + (entry?.error || '方案已删除'));
      return entry.profile;
    });
    if (store.profiles.length + selected.length > 500) throw new Error('最多保存 500 个 API 方案');
    await persist([...store.profiles, ...selected]);
    return { count: selected.length };
  }
  if (method === 'api-manager-delete') {
    extensions.extension_settings[API_BINDINGS_KEY] = (extensions.extension_settings[API_BINDINGS_KEY] || []).filter(link=>link.apiId!==payload.id);
    await persist(store.profiles.filter(item => item.id !== payload.id));
    return true;
  }
  if (method === 'api-manager-save') {
    idle();
    const keys = await readKeys();
    if (payload.capture) ready();
    const profile = normalizeApiProfile(payload.capture ? { ...current(keys), name: payload.name, id: payload.id } : payload.profile);
    if (!payload.newSecret?.trim() && profile.secretId && !keys.some(item => item.id === profile.secretId)) throw new Error('所选密钥已不存在，请重新选择');
    if (store.profiles.length >= 500 && !store.profiles.some(item => item.id === profile.id)) throw new Error('最多保存 500 个 API 方案');
    // New keys go only to the native vault. Restore its previous active key before saving the profile.
    if (typeof payload.newSecret === 'string' && payload.newSecret.trim()) {
      ready();
      lockGeneration();
      let previous = activeId(keys);
      try {
        if (!previous) previous = (await post('write', { key, value: '', label: '酒馆盒子 · 无密钥' })).id;
        if (!previous) throw new Error('无法保存原密钥状态');
        const result = await post('write', { key, value: payload.newSecret.trim(), label: profile.name });
        if (!result.id) throw new Error('密钥保存失败');
        profile.secretId = result.id;
      } finally {
        try { if (previous) await rotate(previous); }
        catch { throw new Error('新密钥操作后恢复原活动密钥失败，请先在酒馆密钥管理器核对当前密钥；方案尚未保存'); }
        finally { unlockGeneration(); }
      }
    }
    profile.updatedAt = Date.now();
    const profiles = [...store.profiles], index = profiles.findIndex(item => item.id === profile.id);
    if (index < 0) profiles.push(profile); else profiles[index] = profile;
    await persist(profiles);
    return { id: profile.id };
  }
  if (method === 'api-manager-apply' || method === 'api-manager-preflight') {
    ready();
    const profile = store.profiles.find(item => item.id === payload.id);
    if (!profile) throw new Error('API 方案不存在，请刷新列表');
    const plan = planApiSwitch(settings, profile, payload.mode);
    const before = clone(settings), keys = await readKeys();
    let previous = activeId(keys), target = plan.secretId;
    if (target !== null && keys.length && !previous) throw new Error('原生密钥库没有活动密钥，请先在酒馆密钥管理器选择一个');
    if (target && !keys.some(item => item.id === target)) throw new Error('方案引用的密钥已被删除或不属于当前酒馆，请编辑方案重新选择');
    ready();
    if (JSON.stringify(settings) !== JSON.stringify(before)) throw new Error('酒馆设置已变化，请重试');
    if (payload.mode !== 'model' && String(document.querySelector('#api_key_custom')?.value || '').trim()) throw new Error('原生 API 密钥输入框有未保存内容，请先保存或清空后再切换');
    if (payload.mode !== 'model' && before.custom_url !== plan.patch.custom_url && !Object.hasOwn(plan.patch, 'custom_include_headers') && String(settings.custom_include_headers || '').trim()) throw new Error('当前连接使用自定义请求头。目标旧方案未保存附加参数，请先编辑该方案的附加参数后再跨地址切换');
    if (method === 'api-manager-preflight') return true;
    // Abort pending native model discovery before it can choose a default model on response.
    const previousStatus = script.online_status;
    let fieldsApplied = false;
    lockGeneration();
    try {
      script.cancelStatusCheck?.('酒馆盒子独立切换 API');
      if (target !== null) {
        if (!target && previous) {
          const result = await post('write', { key, value: '', label: '酒馆盒子 · 无密钥' });
          target = result.id;
          if (!target) throw new Error('无法启用无密钥连接');
        }
        if (target && target !== previous) await rotate(target);
      }
      ready();
      if (JSON.stringify(settings) !== JSON.stringify(before)) throw new Error('切换期间酒馆设置已被外部修改，未覆盖新设置');
      Object.assign(settings, plan.patch);
      fieldsApplied = true;
      // Assign DOM values without input/change: those events can reapply presets or clamp generation parameters.
      for (const [field, selector] of [['custom_url', '#custom_api_url_text'], ['custom_model', '#custom_model_id'], ...API_ADDITIONAL_FIELDS.map(key => [key, '#'+key])]) {
        if (Object.hasOwn(plan.patch, field)) { const control = document.querySelector(selector); if (control) control.value = settings[field]; }
      }
      if (payload.mode !== 'model') {
        if (Array.isArray(openai.model_list)) openai.model_list.splice(0);
        for (const select of document.querySelectorAll('.model_custom_select')) select.replaceChildren(new Option(settings.custom_model, settings.custom_model, true, true));
      } else {
        for (const select of document.querySelectorAll('.model_custom_select')) {
          if (![...select.options].some(option => option.value === settings.custom_model)) select.add(new Option(settings.custom_model, settings.custom_model));
          select.value = settings.custom_model;
        }
      }
      script.saveSettingsDebounced();
      // Check the new connection once without native model-selection events or preset reapplication.
      // A network failure does not undo the user's successful configuration switch.
      const applied = JSON.stringify(settings), connectionKey = target === null ? previous : target;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      let connection;
      try {
        const response = await fetch('/api/backends/chat-completions/status', {
          method: 'POST', headers: script.getRequestHeaders(), signal: controller.signal, cache: 'no-cache',
          body: JSON.stringify({ chat_completion_source: 'custom', custom_url: settings.custom_url,
            custom_include_headers: settings.custom_include_headers || '', secret_id: connectionKey || undefined }),
        });
        if (!response.ok) throw new Error('连接检查失败（'+response.status+'），请检查地址和密钥');
        const result = await response.json();
        if (!result || result.error) throw new Error('连接检查失败，请检查地址和密钥');
        connection = result.bypass ? { ok: true, message: '已执行连接，服务端跳过验证', status: 'Status check bypassed' }
          : { ok: true, message: '连接检查通过', status: '有效的' };
      } catch (error) {
        connection = { ok: false, message: error.name === 'AbortError' ? '连接检查超时，可稍后重试' : '连接检查失败，请检查地址、密钥或网络', status: 'no_connection' };
      } finally { clearTimeout(timer); }
      // Do not let a late response overwrite the status of a connection changed outside this plugin.
      if (script.main_api === 'openai' && JSON.stringify(settings) === applied) {
        try {
          if (activeId(await readKeys()) === connectionKey && script.main_api === 'openai' && JSON.stringify(settings) === applied) script.setOnlineStatus?.(connection.status);
          else connection = { ok: false, message: '连接已被外部修改，请刷新核对' };
        } catch { connection = { ok: false, message: '无法核对当前密钥，请刷新核对连接' }; }
      } else connection = { ok: false, message: '连接已被外部修改，请刷新核对' };
      return { mode: payload.mode, connection };
    } catch (error) {
      // Roll back only our own field writes; leave any external edits intact.
      if (fieldsApplied) for (const [field, value] of Object.entries(plan.patch)) if (settings[field] === value) settings[field] = before[field];
      for (const [field, selector] of [['custom_url', '#custom_api_url_text'], ['custom_model', '#custom_model_id'], ...API_ADDITIONAL_FIELDS.map(key => [key, '#'+key])]) {
        const control = document.querySelector(selector); if (control && Object.hasOwn(plan.patch, field)) control.value = settings[field];
      }
      if (target && target !== previous) {
        try {
          if (activeId(await readKeys()) === target) {
            if (previous) await rotate(previous);
            else { await post('delete', { key, id: target }); await secrets.readSecretState(); }
          }
        } catch { throw new Error('切换未完成且密钥恢复失败，请在酒馆密钥管理器核对当前密钥后重试'); }
      }
      script.saveSettingsDebounced();
      if (previousStatus !== undefined) script.setOnlineStatus?.(previousStatus);
      throw error;
    } finally { unlockGeneration(); }
  }
  throw new Error('未知 API 管理操作');
}

function workbenchWorldName(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || new TextEncoder().encode(value).length > 200
    || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(value) || /[. ]$/.test(value)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)) {
    throw new Error('世界书名称无效：请使用不含路径或特殊字符的简短名称');
  }
  return value;
}

function sameWorkbenchJSON(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a), other = Object.keys(b);
  return keys.length === other.length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameWorkbenchJSON(a[key], b[key]));
}

function assertWorkbenchCache(world, name, base, create = false) {
  const cache = world.worldInfoCache;
  if (!cache || !['has', 'get', 'set'].every(key => typeof cache[key] === 'function')) throw new Error('当前酒馆不支持安全同步世界书缓存，请更新酒馆');
  if (cache.has(name) && (create || !sameWorkbenchJSON(cache.get(name), base))) {
    throw new Error('世界书「' + name + '」存在原生未保存修改或缓存冲突，请先核对并处理原生编辑器的修改，再重新载入');
  }
}

async function workbenchDiskNames(env, options) {
  const data = await readSnapshotPersistence(env, '/api/settings/get', {}, options);
  if (!Array.isArray(data.world_names) || !data.world_names.every(name => typeof name === 'string')) throw new Error('无法核验世界书列表，请重试');
  return data.world_names;
}

function workbenchEditorName(world) {
  const selected = document.querySelector('#world_editor_select')?.value;
  return selected !== undefined && selected !== '' ? world.world_names?.[Number(selected)] : undefined;
}

async function syncWorkbenchBook(env, name, data, previous, create) {
  // Never replace a native edit made by another extension while the HTTP request was in flight.
  assertWorkbenchCache(env.world, name, previous, create);
  env.world.worldInfoCache.set(name, clone(data));
  if (workbenchEditorName(env.world) === name) {
    if (typeof env.world.showWorldEditor !== 'function') throw new Error('无法刷新原生世界书编辑器，请关闭并重新打开原生编辑器');
    // Refresh only the already selected book: this replaces editor event closures without mounting/selecting a book.
    await env.world.showWorldEditor(name);
  }
}

async function handleWorkbenchWorldbook(method, payload) {
  const name = workbenchWorldName(payload.name);
  const [script, world] = await Promise.all([import('/script.js'), import('/scripts/world-info.js')]);
  const env = {script, world};
  // Android local servers may need longer to enumerate settings/presets and read large books.
  // Keep disk existence checks: the native get endpoint returns an empty book for missing files.
  const reading = method === 'workbench-read-worldbook';
  const names = await workbenchDiskNames(env, reading ? {timeoutMs:45000, label:'世界书列表'} : undefined);
  if (method === 'workbench-read-worldbook') {
    if (!names.includes(name)) throw new Error('该世界书不存在，请重新读取列表');
    const book = await readSnapshotPersistence(env, '/api/worldinfo/get', {name}, {timeoutMs:45000, label:'世界书正文'});
    normalizeWorkbenchBook(book);
    assertWorkbenchCache(world, name, book);
    world.worldInfoCache.set(name, clone(book));
    // The raw disk object is the CAS baseline; normalization must not change it.
    return {name, book: clone(book)};
  }
  if (typeof payload.create !== 'boolean') throw new Error('请明确选择覆盖保存或另存世界书');
  const create = payload.create, book = normalizeWorkbenchBook(payload.book), base = payload.base;
  const exists = list => list.some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (create && (exists(names) || exists(world.world_names || []))) throw new Error('同名世界书已存在，请使用其他名称');
  if (!create && !names.includes(name)) throw new Error('该世界书不存在，不能覆盖保存，请重新载入或另存');
  if (!create) normalizeWorkbenchBook(base);
  assertWorkbenchCache(world, name, base, create);
  if (create && typeof world.updateWorldInfoList !== 'function') throw new Error('当前酒馆不支持刷新世界书列表，请更新酒馆');
  if (workbenchEditorName(world) === name && typeof world.showWorldEditor !== 'function') throw new Error('当前酒馆不支持安全刷新原生世界书编辑器');
  // Block ordinary native editor input while checking and writing; restore its previous state even on failure.
  const editor = document.getElementById('WorldInfo'), wasInert = editor?.inert;
  if (editor) editor.inert = true;
  let writeAttempted = false, synced = false;
  try {
    if (world.worldInfoCache.has(name)) {
      // Native saveWorldInfo caches first and debounces the POST. Even a reverted edit can leave an old
      // equal-to-base save queued. Let that timer run before the final check, without cancelling other books.
      const {debounce_timeout} = await import('/scripts/constants.js');
      const delay = debounce_timeout?.relaxed;
      if (!Number.isFinite(delay) || delay < 0 || delay > 10000) throw new Error('无法确认原生世界书延迟保存状态，请更新酒馆后重试');
      await new Promise(resolve => setTimeout(resolve, delay + 100));
    }
    // The debounce only tells us when a POST starts. Wait for all real responses, including slow old saves.
    await awaitWorkbenchWorldWrites();
    if (create) {
      if (exists(await stableWorkbenchWorldRead(() => workbenchDiskNames(env)))) throw new Error('同名世界书已存在，请使用其他名称');
    } else {
      const current = await stableWorkbenchWorldRead(() => readSnapshotPersistence(env, '/api/worldinfo/get', {name}));
      if (!sameWorkbenchJSON(current, base)) throw new Error('世界书「' + name + '」已被外部修改，保存冲突；请重新载入或另存');
    }
    assertWorkbenchCache(world, name, base, create);
    // The native API has no atomic compare-and-swap. Check as late as possible and serialize all plugin writes.
    writeAttempted = true;
    await writeSnapshotResource(env, '/api/worldinfo/edit', {name, data: book});
    await awaitWorkbenchWorldWrites();
    const persisted = await stableWorkbenchWorldRead(() => readSnapshotPersistence(env, '/api/worldinfo/get', {name}));
    normalizeWorkbenchBook(persisted);
    await syncWorkbenchBook(env, name, persisted, base, create);
    synced = true;
    if (!sameWorkbenchJSON(persisted, book)) throw new Error('世界书保存后读回数据不一致，未确认保存成功；草稿已保留，请重新载入核验');
    if (create) {
      await world.updateWorldInfoList();
      if (!world.world_names?.includes(name)) throw new Error('世界书已写入，但列表刷新失败；请刷新后核验，勿重复覆盖');
    }
    const event = script.event_types?.WORLDINFO_UPDATED;
    if (event) await script.eventSource.emit(event, name, clone(persisted));
    const finalBook = await stableWorkbenchWorldRead(() => readSnapshotPersistence(env, '/api/worldinfo/get', {name}));
    if (!sameWorkbenchJSON(finalBook, persisted)) throw new Error('世界书保存后又发生外部修改，未确认保存成功；请重新载入核验');
    assertWorkbenchCache(world, name, persisted);
    return {name, book: clone(persisted)};
  } catch (error) {
    if (writeAttempted && !synced) {
      // A timeout/HTTP error may happen after the server wrote the book. Read back only; never roll back over newer data.
      try {
        const actual = await readSnapshotPersistence(env, '/api/worldinfo/get', {name});
        normalizeWorkbenchBook(actual);
        await syncWorkbenchBook(env, name, actual, base, create);
      } catch { /* Keep the original error and any concurrent native edits. The UI keeps its draft. */ }
    }
    throw error;
  } finally {
    if (editor) editor.inert = wasInert;
  }
}

// 设置快照保存当前开关与挂载，扩展资源按稳定标识恢复；不覆盖预设或世界书正文。
const SNAPSHOT_KEY = 'preset_compare_snapshots';
let snapshotQueue = Promise.resolve();
let snapshotBusy = 0;
let snapshotEpoch = 0;
let snapshotNotify = () => {};
let snapshotInstalled = false;
let snapshotAutoTimer = null;
let snapshotAutoPending = false;
let snapshotAutoToken = 0;
let snapshotPresetLoads = 0;
const snapshotPresetWaiters = new Set();

async function snapshotEnvironment() {
  const [script, openai, extensions, world, manager] = await Promise.all([
    import('/script.js'), import('/scripts/openai.js'), import('/scripts/extensions.js'),
    import('/scripts/world-info.js'), getPresetManager(),
  ]);
  return {script, openai, extensions, world, manager};
}

function snapshotStore(env) {
  const settings = env.extensions.extension_settings;
  if (!settings || typeof settings !== 'object') throw new Error('酒馆设置尚未就绪');
  settings[SNAPSHOT_KEY] ??= {version: 1, snapshots: [], characterBindings: {}};
  const store = settings[SNAPSHOT_KEY];
  if (store.version !== 1 || !Array.isArray(store.snapshots) || !store.characterBindings || typeof store.characterBindings !== 'object' || Array.isArray(store.characterBindings)) throw new Error('快照库格式不受支持，请保留数据并更新插件');
  return store;
}

function snapshotContext(env) {
  const ctx = globalThis.SillyTavern?.getContext?.() || {};
  const group = ctx.groupId;
  const character = !group ? (env.script.characters || ctx.characters || [])[env.script.this_chid ?? ctx.characterId] : null;
  const characterKey = character?.avatar || '';
  const chatId = env.script.getCurrentChatId?.() ?? ctx.chatId;
  const scope = JSON.stringify([group || '', characterKey, chatId ?? '', snapshotEpoch]);
  const presetName = String(env.manager.getSelectedPresetName?.() || env.openai.oai_settings?.preset_settings_openai || '');
  const metadata = env.script.chat_metadata || ctx.chatMetadata;
  const store = snapshotStore(env);
  const context = {
    key: JSON.stringify([scope, presetName]), scope, characterKey, presetName,
    characterName: character?.name || (group ? '群聊' : '未选择角色'),
    chatName: chatId == null || chatId === '' ? '未打开聊天' : String(chatId),
    canBindChat: Boolean((characterKey || group) && chatId != null && chatId !== '' && metadata),
    canBindCharacter: Boolean(characterKey),
    chatBindingId: metadata?.[SNAPSHOT_KEY]?.snapshotId || null,
    characterBindingId: characterKey && Object.hasOwn(store.characterBindings, characterKey) ? store.characterBindings[characterKey] : null,
  };
  context.resources = snapshotResourceSummary(env, context);
  const permissions = env.extensions.extension_settings;
  context.regexAuthorization = [
    context.resources.regex.preset.length && !permissions.preset_allowed_regex?.openai?.includes(presetName) ? '预设正则尚未在酒馆授权启用，快照只恢复条目开关。' : '',
    context.resources.regex.character.length && !permissions.character_allowed_regex?.includes(characterKey) ? '角色正则尚未在酒馆授权启用，快照只恢复条目开关。' : '',
  ].filter(Boolean);
  return context;
}

function snapshotCharacter(env) {
  const ctx = globalThis.SillyTavern?.getContext?.() || {};
  return ctx.groupId ? null : (env.script.characters || ctx.characters || [])[env.script.this_chid ?? ctx.characterId];
}
function snapshotRegexSources(env, preset = env.openai.oai_settings) {
  return {global:env.extensions.extension_settings.regex || [], preset:preset?.extensions?.regex_scripts || [], character:snapshotCharacter(env)?.data?.extensions?.regex_scripts || []};
}
function snapshotWorldSettings(env) {return env.world.world_info || env.world.getWorldInfoSettings?.().world_info;}
function snapshotResourceSummary(env, context) {
  const fileName = context.characterKey.replace(/\.[^.]+$/, '');
  const world = snapshotWorldSettings(env);
  const chatBook = (env.script.chat_metadata || globalThis.SillyTavern?.getContext?.().chatMetadata)?.[env.world.METADATA_KEY || 'world_info'];
  const sources = snapshotRegexSources(env);
  return {
    worlds:{global:selectedSnapshotWorlds(env), character:fileName ? [...(world?.charLore?.find(item=>item.name===fileName)?.extraBooks || [])] : [], chat:context.canBindChat && typeof chatBook==='string' && chatBook ? [chatBook] : []},
    regex:Object.fromEntries(Object.entries(sources).map(([scope,scripts])=>[scope,captureRegexSwitches(scripts)])),
  };
}
async function snapshotReadBooks(env, names, context, includeContent=false) {
  const books=[];
  if (!Array.isArray(names) || names.some(name=>typeof name!=='string')) throw new Error('世界书列表无效');
  for (const name of new Set(names)) {
    assertSnapshotScope(env,context.scope,context.presetName);
    if (!env.world.world_names?.includes(name)) throw new Error('找不到世界书「'+name+'」');
    if (typeof env.world.loadWorldInfo!=='function') throw new Error('酒馆未提供世界书读取接口');
    const data=await withSnapshotTimeout(env.world.loadWorldInfo(name),'世界书读取超时，请检查连接后重试');
    assertSnapshotScope(env,context.scope,context.presetName);
    const book=captureWorldEntries(name,data);
    if(includeContent){const content=new Map(Object.entries(data.entries).map(([key,entry])=>[String(entry.uid??key),String(entry.content??'')]));for(const entry of book.entries)entry.content=content.get(entry.uid)||'';}
    books.push(book);
  }
  return books;
}
async function snapshotCaptureResources(env, context, scope = {worlds:true,regex:true}) {
  const resources=clone(snapshotResourceSummary(env,context));
  resources.version=2;resources.worlds={global:scope.worlds ? resources.worlds.global : []};
  resources.regex={global:scope.regex ? resources.regex.global : [],preset:[],character:[]};
  resources.worldEntries=await snapshotReadBooks(env,resources.worlds.global,context);
  return validateSnapshotResources(resources);
}
function snapshotPresetDraft(env, presetName, orderCharacterId) {
  const selected=snapshotContext(env).presetName===presetName;
  const preset=selected ? env.openai.oai_settings : readPresetByName(env.manager,presetName);
  if (!preset) throw new Error('找不到预设「'+presetName+'」');
  const draft=captureSnapshot({name:'新快照',presetName,settings:preset,orderCharacterId,groupState:selected?snapshotGroups(env):preset.extensions?.baibaiToolkit?.presetPromptGroups,worldNames:[]});
  const groups=selected?snapshotGroups(env):preset.extensions?.baibaiToolkit?.presetPromptGroups;
  const view=regexEditor(preset.extensions?.regex_scripts||[],snapshotRegexGroups(env,'preset',presetName,preset));
  return {...draft,regex:captureRegexSwitches(preset.extensions?.regex_scripts || []),editor:{...snapshotPresetEditor(draft,preset,groups),regex:{preset:view.entries},regexGroups:{preset:view.groups}}};
}

function snapshotRegexGroups(env,scope,presetName,preset) {
  const key=scope==='global'?'global':scope==='character'?'scoped:'+(snapshotCharacter(env)?.avatar||'none'):'preset:openai:'+presetName;
  const scopes=env.extensions.extension_settings.baiBaiToolkit?.regexListGroups?.scopes;
  // 活动预设使用柏宝箱的实时分组；其他预设读取其可移植分组，不初始化宿主设置。
  if(scope==='preset'&&presetName!==env.manager.getSelectedPresetName?.())return preset?.extensions?.baibaiToolkit?.regexGroups||scopes?.[key]||null;
  return scopes?.[key]||(scope==='preset'?preset?.extensions?.baibaiToolkit?.regexGroups:null);
}
async function readSnapshotEditor(env, payload) {
  const context=snapshotContext(env);
  assertSnapshotContext(env,payload.contextKey);
  await waitSnapshotPreset(env,context);await settleBaiBai(env,context);assertSnapshotIdle(env);
  if(payload.presetName)return snapshotPresetDraft(env,payload.presetName,snapshotSettings(env).orderCharacterId);
  if(payload.names)return snapshotReadBooks(env,payload.names,context,true);
  const existing=snapshotStore(env).snapshots.find(s=>s.id===payload.id);
  if(payload.id&&!existing)throw new Error('快照已删除，请刷新');
  const warnings=[],draft=existing?clone(existing):snapshotPresetDraft(env,context.presetName,snapshotSettings(env).orderCharacterId);
  draft.scope=existing?snapshotScope(existing):{preset:true,worlds:true,regex:true};
  if (!draft.scope.preset) {
    const current=snapshotPresetDraft(env,context.presetName,snapshotSettings(env).orderCharacterId);
    for (const key of ['presetName','orderCharacterId','entries','groups']) draft[key]=current[key];
  }
  delete draft.regex;delete draft.editor;
  if(!draft.resources){
    draft.resources=await snapshotCaptureResources(env,context);
    if(existing){
      warnings.push('旧快照未保存世界书条目配置和正则，本次已从当前设置补齐；请检查后保存。');
      draft.resources.worlds.global=[...draft.worldNames];
      draft.resources.worldEntries=await snapshotReadBooks(env,draft.worldNames,context);
      const preset=draft.presetName===context.presetName?env.openai.oai_settings:readPresetByName(env.manager,draft.presetName);
      draft.resources.regex.preset=captureRegexSwitches(preset?.extensions?.regex_scripts||[]);
    }else draft.worldNames=[...draft.resources.worlds.global];
  }
  if(draft.resources.worlds.character?.length||draft.resources.worlds.chat?.length)warnings.push('快照现在仅保存全局世界书，旧版角色与聊天附加挂载不再应用。');
  draft.resources=normalizeSnapshotResources(draft.resources);
  const preset=draft.presetName===context.presetName?env.openai.oai_settings:readPresetByName(env.manager,draft.presetName);
  if(!preset)throw new Error('找不到预设「'+draft.presetName+'」');
  if (!draft.scope.regex) draft.resources.regex={global:captureRegexSwitches(snapshotRegexSources(env,preset).global),preset:[],character:[]};
  const groups=draft.presetName===context.presetName?snapshotGroups(env):preset.extensions?.baibaiToolkit?.presetPromptGroups;
  const editor={...snapshotPresetEditor(draft,preset,groups),regex:{},regexGroups:{}};
  for(const [scope,scripts] of [['global',snapshotRegexSources(env,preset).global]]){
    const view=regexEditor(scripts,snapshotRegexGroups(env,scope,draft.presetName,preset),draft.resources.regex[scope]);
    editor.regex[scope]=view.entries;editor.regexGroups[scope]=view.groups;
  }
  const available=draft.resources.worlds.global.filter(name=>env.world.world_names.includes(name));
  editor.worldEntries=await snapshotReadBooks(env,available,context,true);
  for(const name of draft.resources.worlds.global)if(!available.includes(name))warnings.push('世界书「'+name+'」已缺失，可取消挂载后保存。');
  assertSnapshotContext(env,payload.contextKey);
  const {preset_names}=env.manager.getPresetList();
  return clone({draft,editor,presets:Array.isArray(preset_names)?preset_names:Object.keys(preset_names||{}),worldNames:env.world.world_names||[],context,warnings});
}

function assertSnapshotContext(env, key) {
  if (!key || snapshotContext(env).key !== key) throw new Error('当前聊天或预设已切换，请重新操作');
}

function assertSnapshotScope(env, scope, presetName) {
  const current = snapshotContext(env);
  if (current.scope !== scope || (presetName && current.presetName !== presetName)) {
    const error = new Error('聊天或预设已切换，已取消过期的快照操作');
    error.name = 'SnapshotContextChanged';
    throw error;
  }
}

function assertSnapshotIdle(env) {
  if (env.script.isGenerating?.() || env.script.is_send_press) {
    const error = new Error('正在生成回复，请结束后再应用快照');
    error.name = 'SnapshotGenerationActive';
    throw error;
  }
}

function snapshotSettings(env) {
  if (env.script.main_api !== 'openai') throw new Error('请先切换到聊天补全（Chat Completion）模式');
  const settings = env.openai.oai_settings;
  if (settings?.preset_settings_openai !== snapshotContext(env).presetName) throw new Error('预设尚未加载完成，请稍后重试');
  const manager = env.openai.promptManager;
  const orderCharacterId = manager?.activeCharacter?.id ?? manager?.configuration?.promptOrder?.dummyId;
  snapshotOrder(settings, orderCharacterId);
  return {settings, orderCharacterId};
}

function baiBaiState() {
  const value = globalThis.__baiBaiToolkitExtensionInstalled;
  return value && typeof value === 'object' ? value : null;
}

function snapshotGroups(env) {
  if (nativeGroupController?.owns('preset')) return env.openai.oai_settings?.extensions?.baibaiToolkit?.presetPromptGroups || null;
  const bai = baiBaiState();
  const name = snapshotContext(env).presetName;
  if (bai?.presetPromptGroupRuntimePresetName === name && Array.isArray(bai.presetPromptGroupRuntimeState?.groups)) return bai.presetPromptGroupRuntimeState;
  return env.openai.oai_settings?.extensions?.baibaiToolkit?.presetPromptGroups || null;
}

function selectedSnapshotWorlds(env) {
  const value = env.world.selected_world_info ?? env.world.getWorldInfoSettings?.().world_info?.globalSelect;
  if (!Array.isArray(value)) throw new Error('无法读取当前全局世界书挂载');
  return [...value];
}

function snapshotList(env) {
  const store = snapshotStore(env), context = snapshotContext(env);
  const active = resolveSnapshotBinding(store, context.canBindChat ? context.chatBindingId : null, context.characterKey);
  return clone({snapshots: store.snapshots, context, activeBinding: active ? {id: active.snapshot.id, name: active.snapshot.name, source: active.source} : null, busy: snapshotBusy > 0});
}

async function readSnapshotPersistence(env, url, body, {timeoutMs = 8000, label} = {}) {
  const getHeaders = env.script.getRequestHeaders || globalThis.SillyTavern?.getContext?.().getRequestHeaders;
  if (typeof getHeaders !== 'function') throw new Error('酒馆未提供保存核验接口，请更新酒馆后重试');
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, {method: 'POST', headers: getHeaders(), body: JSON.stringify(body), cache: 'no-cache', signal: abort.signal});
    if (!response.ok) throw new Error(label ? label+'读取失败（HTTP '+response.status+'），请检查酒馆服务后重试' : '保存后读取失败，请检查服务器连接');
    return await response.json();
  } catch (error) {
    if (label && abort.signal.aborted) throw new Error(label+'读取超时（'+timeoutMs/1000+' 秒），请保持酒馆在前台后重试，或导入世界书 JSON');
    if (label && error.name === 'AbortError') throw new Error(label+'读取被中断，请保持酒馆在前台后重试，或导入世界书 JSON');
    throw error;
  } finally {clearTimeout(timer);}
}

async function saveSnapshotSettings(env, verifySwitches = false) {
  const expectedStore = JSON.stringify(snapshotStore(env));
  const settings = env.openai.oai_settings;
  const expectedOrder = verifySwitches ? JSON.stringify(settings.prompt_order) : null;
  const expectedGroups = verifySwitches ? JSON.stringify(settings.extensions?.baibaiToolkit?.presetPromptGroups || null) : null;
  const expectedWorlds = verifySwitches ? JSON.stringify(selectedSnapshotWorlds(env)) : null;
  const expectedResources = verifySwitches ? JSON.stringify({global:env.extensions.extension_settings.regex || [],preset:settings.extensions?.regex_scripts || [],charLore:snapshotWorldSettings(env)?.charLore || []}) : null;
  await env.script.saveSettings();
  // 原生 saveSettings 会吞掉网络异常，必须读取已保存值，不能把正常返回当作成功。
  const result = await readSnapshotPersistence(env, '/api/settings/get', {});
  const persisted = typeof result?.settings === 'string' ? JSON.parse(result.settings) : result?.settings;
  if (JSON.stringify(persisted?.extension_settings?.[SNAPSHOT_KEY]) !== expectedStore) throw new Error('未确认快照保存成功，请检查服务器连接后重试');
  if (verifySwitches && (JSON.stringify(persisted?.oai_settings?.prompt_order) !== expectedOrder
    || JSON.stringify(persisted?.oai_settings?.extensions?.baibaiToolkit?.presetPromptGroups || null) !== expectedGroups
    || JSON.stringify(persisted?.world_info_settings?.world_info?.globalSelect || []) !== expectedWorlds)) throw new Error('未确认开关和世界书保存成功，请检查当前设置后重试');
  if (verifySwitches && JSON.stringify({global:persisted?.extension_settings?.regex || [],preset:persisted?.oai_settings?.extensions?.regex_scripts || [],charLore:persisted?.world_info_settings?.world_info?.charLore || []}) !== expectedResources) throw new Error('未确认正则和角色附加世界书保存成功');
}

async function saveSnapshotMetadata(env, context, metadata, verifyWorld = false) {
  const expected = JSON.stringify(metadata[SNAPSHOT_KEY] || null);
  const worldKey=env.world.METADATA_KEY || 'world_info', expectedWorld=metadata[worldKey] || null;
  await env.script.saveMetadata();
  assertSnapshotScope(env, context.scope);
  const group = !context.characterKey;
  const body = group ? {id: context.chatName} : {ch_name: context.characterName, avatar_url: context.characterKey, file_name: context.chatName};
  const persisted = await readSnapshotPersistence(env, group ? '/api/chats/group/get' : '/api/chats/get', body);
  assertSnapshotScope(env, context.scope);
  if (!Array.isArray(persisted) || JSON.stringify(persisted[0]?.chat_metadata?.[SNAPSHOT_KEY] || null) !== expected) throw new Error('未确认聊天绑定保存成功，请检查连接并重新绑定');
  if (verifyWorld && (persisted[0]?.chat_metadata?.[worldKey] || null)!==expectedWorld) throw new Error('未确认聊天世界书保存成功');
}

async function writeSnapshotResource(env, url, body) {
  const getHeaders=env.script.getRequestHeaders || globalThis.SillyTavern?.getContext?.().getRequestHeaders;
  if (typeof getHeaders!=='function') throw new Error('酒馆未提供资源保存接口');
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
  try {
    const response=await fetch(url,{method:'POST',headers:getHeaders(),body:JSON.stringify(body),signal:abort.signal});
    if (!response.ok) throw new Error('资源保存失败（HTTP '+response.status+'）');
  } finally {clearTimeout(timer);}
}
async function writeSnapshotBook(env, name, data) {
  // 直接调用原生端点以检查 HTTP 状态，避免 saveWorldInfo 取消其他书的共享延迟保存。
  await writeSnapshotResource(env,'/api/worldinfo/edit',{name,data});
  const persisted=await readSnapshotPersistence(env,'/api/worldinfo/get',{name});
  if (JSON.stringify(persisted)!==JSON.stringify(data)) throw new Error('世界书「'+name+'」保存核验失败');
  env.world.worldInfoCache.set(name,clone(data));
  const event=env.script.event_types?.WORLDINFO_UPDATED;
  if (event) await env.script.eventSource.emit(event,name,clone(data));
  const selected=document.querySelector('#world_editor_select')?.value;
  if (selected!==undefined && selected!=='' && env.world.world_names[Number(selected)]===name) await env.world.showWorldEditor?.(name);
}
function patchSnapshotRegexArray(current, saved, scope) {
  // 保留原生正则列表事件闭包引用的对象；仅改变开关，不替换表达式与排序。
  const states=new Map(captureRegexSwitches(saved).map(item=>[item.id,item.enabled]));
  const records=captureRegexSwitches(current);
  for (let i=0;i<current.length;i++) if(states.has(records[i].id)) {
    current[i].disabled=!states.get(records[i].id);
    const container=document.getElementById(({global:'saved_regex_scripts',preset:'saved_preset_scripts',character:'saved_scoped_scripts'})[scope]);
    const row=container && [...container.querySelectorAll('[id]')].find(node=>node.id===current[i].id);
    const checkbox=row?.querySelector('.disable_regex');if(checkbox)checkbox.checked=current[i].disabled;
  }
  return current;
}
function rollbackSnapshotRegexArray(current, before, after, scope) {
  const old=new Map(captureRegexSwitches(before).map(item=>[item.id,item.enabled]));
  const expected=new Map(captureRegexSwitches(after).map(item=>[item.id,item.enabled]));
  const restore=captureRegexSwitches(current).filter(item=>old.has(item.id)&&old.get(item.id)!==expected.get(item.id)&&item.enabled===expected.get(item.id)).map(item=>({...item,enabled:old.get(item.id)}));
  patchSnapshotRegexArray(current,restoreRegexSwitches(restore,current).scripts,scope);
}
function syncSnapshotRegexCaches(env, context, plans, journal) {
  const runtime=baiBaiState()?.regexQuickOperationOptimization;
  if(!runtime)return;
  const seen=new Set(Object.values(snapshotRegexSources(env)).flat());
  for(const scope of Object.keys(plans)){
    const key=scope==='global'?'global':scope==='preset'?'preset:openai:'+context.presetName:'scoped:'+context.characterKey;
    const arrays=[],pending=runtime.pendingRegexScriptSaves?.get?.(key);
    if(Array.isArray(pending?.scripts))arrays.push(pending.scripts);
    // Vue 模型只同步仍对应当前宿主条目的副本，分组归属与顺序保持原样。
    const list=runtime.vueManager?.state?.lists?.[scope==='character'?'scoped':scope];
    for(const group of list?.groups||[])if(Array.isArray(group.scripts))arrays.push(group.scripts);
    for(const array of arrays){
      const records=array.filter(record=>{if(seen.has(record))return false;seen.add(record);return true;});
      if(!records.length)continue;
      const before=clone(records),after=restoreRegexSwitches(captureRegexSwitches(plans[scope].scripts),records).scripts;
      journal.push(async()=>rollbackSnapshotRegexArray(records,before,after,scope));
      patchSnapshotRegexArray(records,after,scope);
    }
  }
}
function syncSnapshotOriginalBook(env, data) {
  if (!data.originalData || typeof env.world.setWIOriginalDataValue!=='function') return;
  for (const entry of Object.values(data.entries)) {
    for (const [field,path] of Object.entries(env.world.originalWIDataKeyMap || {})) {
      if (!['content','comment','enabled'].includes(field) && entry[field]!==undefined) env.world.setWIOriginalDataValue(data,entry.uid,path,entry[field]);
    }
    env.world.setWIOriginalDataValue(data,entry.uid,'enabled',!entry.disable);
    env.world.setWIOriginalDataValue(data,entry.uid,'position',entry.position===0?'before_char':'after_char');
  }
}
async function writeSnapshotCharacterRegex(env, character, scripts) {
  await writeSnapshotResource(env,'/api/characters/merge-attributes',{avatar:character.avatar,data:{extensions:{regex_scripts:scripts}}});
  const persisted=await readSnapshotPersistence(env,'/api/characters/get',{avatar_url:character.avatar});
  if (JSON.stringify(persisted?.data?.extensions?.regex_scripts || [])!==JSON.stringify(scripts)) throw new Error('角色正则保存核验失败');
  character.data ??= {};character.data.extensions ??= {};
  character.data.extensions.regex_scripts=patchSnapshotRegexArray(character.data.extensions.regex_scripts || [],scripts,'character');
  if (character.json_data) {
    const json=JSON.parse(character.json_data);json.data ??= {};json.data.extensions ??= {};json.data.extensions.regex_scripts=clone(scripts);character.json_data=JSON.stringify(json);
    if (snapshotCharacter(env)===character) {const input=document.querySelector('#character_json_data');if(input)input.value=character.json_data;}
  }
}
async function prepareSnapshotResources(env, snapshot, context, allowMissingWorlds) {
  if (!snapshot.resources) return null;
  const resources=normalizeSnapshotResources(snapshot.resources);
  const scope=snapshotScope(snapshot);
  if (env.script.menu_type==='create') throw new Error('请先退出角色创建界面再应用快照');
  if (!context.canBindCharacter && resources.regex.character.length) throw new Error('此快照包含角色正则，请先打开角色');
  if (scope.worlds && !snapshotWorldSettings(env)) throw new Error('世界书挂载设置尚未就绪');
  if (resources.worldEntries.length && typeof env.world.worldInfoCache?.set!=='function') throw new Error('当前酒馆不支持同步世界书缓存，请更新酒馆');
  const books=[],warnings=[];
  for (const saved of resources.worldEntries) {
    if (!env.world.world_names.includes(saved.name)) {if(allowMissingWorlds)continue;throw new Error('找不到世界书「'+saved.name+'」');}
    // 等待原生编辑器的延迟保存，避免快照写入随后被旧缓存覆盖。
    let current, disk;const deadline=Date.now()+3500;
    do {
      assertSnapshotScope(env,context.scope,context.presetName);
      current=await withSnapshotTimeout(env.world.loadWorldInfo(saved.name),'世界书读取超时，请检查连接后重试');
      disk=await readSnapshotPersistence(env,'/api/worldinfo/get',{name:saved.name});
      if (JSON.stringify(current)===JSON.stringify(disk)) break;
      if (Date.now()>=deadline) throw new Error('世界书「'+saved.name+'」仍有未保存修改，请保存后重试');
      await new Promise(resolve=>setTimeout(resolve,100));
    } while (true);
    const plan=restoreWorldEntries(saved,current);syncSnapshotOriginalBook(env,plan.data);
    if (plan.missing.length) warnings.push(saved.name+' 已跳过缺失条目：'+plan.missing.join('、'));
    books.push({name:saved.name,before:clone(current),after:plan.data});
  }
  assertSnapshotScope(env,context.scope,context.presetName);
  return {resources,books,warnings,scope};
}
async function applySnapshotResources(env, prepared, context, journal) {
  if (!prepared) return [];
  const {resources,books,warnings,scope:included}=prepared;
  const guard=()=>{assertSnapshotScope(env,context.scope,context.presetName);assertSnapshotIdle(env);};
  const sources=snapshotRegexSources(env), regexPlans={};
  if (included.regex) {
  for (const scope of ['global']) {
    regexPlans[scope]=restoreRegexSwitches(resources.regex[scope],sources[scope]);
    if (regexPlans[scope].missing.length) warnings.push('已跳过缺失的'+({global:'全局',preset:'预设',character:'角色'}[scope])+'正则：'+regexPlans[scope].missing.join('、'));
  }
  const previousGlobal=clone(sources.global);
  journal.push(async()=>{
    // 回滚持有的原始记录引用，不把整个新聊天/新预设设置替换成旧副本。
    // 正则只有两种状态：若已被外部改回原值，不再写入。
    if(env.extensions.extension_settings.regex===sources.global)rollbackSnapshotRegexArray(sources.global,previousGlobal,regexPlans.global.scripts,'global');


  });
  syncSnapshotRegexCaches(env,context,regexPlans,journal);
  env.extensions.extension_settings.regex=patchSnapshotRegexArray(sources.global,regexPlans.global.scripts,'global');

  }
  for (const book of books) {
    guard();
    if (JSON.stringify(book.before)===JSON.stringify(book.after)) continue;
    journal.push(async()=>{
      const current=await readSnapshotPersistence(env,'/api/worldinfo/get',{name:book.name});
      if(JSON.stringify(current)===JSON.stringify(book.before)){env.world.worldInfoCache.set(book.name,clone(book.before));return;}
      if(JSON.stringify(current)!==JSON.stringify(book.after))throw new Error('世界书已被外部修改，保留新内容');
      await writeSnapshotBook(env,book.name,book.before);
    });
    await writeSnapshotBook(env,book.name,book.after);guard();
  }
  return warnings;
}

function snapshotSerial(action, notify = true) {
  const run = snapshotQueue.then(async () => {
    snapshotBusy++;
    try { return await action(); }
    finally { snapshotBusy--; if (notify) snapshotNotify(); }
  });
  snapshotQueue = run.catch(() => {});
  return run;
}

async function withSnapshotTimeout(promise, message, ms = 8000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(message)), ms);})]); }
  finally { clearTimeout(timer); }
}

async function settleBaiBai(env, context) {
  const regex=baiBaiState()?.regexQuickOperationOptimization;
  if(regex?.regexChangesSavePromise)await withSnapshotTimeout(regex.regexChangesSavePromise,'柏宝箱仍在保存正则，请稍后重试');
  if(regex?.vueManager?.dragging||regex?.regexChangesSaveInFlight)throw new Error('柏宝箱正则正在调整，请稍后重试');
  const vue = baiBaiState()?.__baiBaiToolkitPresetVueListManager;
  if (vue?.pendingChangesSavePromise) await withSnapshotTimeout(vue.pendingChangesSavePromise, '柏宝箱仍在保存，请稍后重试');
  const writing = vue?.openAiPresetSaveRequestStates?.get?.(context.presetName)?.promise;
  if (writing) await withSnapshotTimeout(writing, '柏宝箱仍在写入预设，请稍后重试');
  assertSnapshotScope(env, context.scope, context.presetName);
  // 正在拖拽的排序尚未落盘时不抓取中间状态；由用户松开后重试。
  if (vue?.state?.dragging || vue?.pendingOrderSave || vue?.saveFrame != null || vue?.saveTimer != null) throw new Error('预设条目正在排序，请松开拖拽并稍后重试');
}

async function waitSnapshotPreset(env, context) {
  if (snapshotPresetLoads > 0) {
    let resolve;
    try {
      await withSnapshotTimeout(new Promise(done => {resolve = done; snapshotPresetWaiters.add(done);}), '酒馆预设仍在加载，请加载完成后重试');
    } finally {snapshotPresetWaiters.delete(resolve);}
  }
  assertSnapshotScope(env, context.scope, context.presetName);
}

async function selectSnapshotPreset(env, name, scope) {
  if (snapshotContext(env).presetName === name) return;
  const {preset_names: names} = env.manager.getPresetList();
  const value = Array.isArray(names) ? names.indexOf(name) : (Object.hasOwn(names || {}, name) ? names[name] : undefined);
  if (value === undefined || value === -1) throw new Error('找不到预设「'+name+'」，请更新快照');
  const events = env.script.eventSource, type = env.script.event_types?.OAI_PRESET_CHANGED_AFTER;
  if (!events?.on || !type || !env.manager.selectPreset) throw new Error('当前酒馆不支持等待预设切换，请手动选择预设后重试');
  let listener, timer;
  try {
    await new Promise((resolve, reject) => {
      listener = () => {
        try { assertSnapshotScope(env, scope, name); resolve(); } catch (error) { reject(error); }
      };
      events.on(type, listener);
      timer = setTimeout(() => reject(new Error('预设加载超时，请确认酒馆预设状态后重试')), 8000);
      try { env.manager.selectPreset(String(value)); } catch (error) { reject(error); }
    });
    assertSnapshotScope(env, scope, name);
  } finally {
    clearTimeout(timer);
    if (listener) (events.removeListener || events.off)?.call(events, type, listener);
  }
}

function setSnapshotWorlds(env, names) {
  const select = document.getElementById('world_info');
  if (!select || typeof env.world.onWorldInfoChange !== 'function') throw new Error('酒馆全局世界书选择器尚未就绪');
  const values = names.map(name => String(env.world.world_names.indexOf(name)));
  const options = [...select.options];
  if (values.some(value => !options.some(option => option.value === value))) throw new Error('世界书列表尚未刷新，请稍后重试');
  for (const option of options) option.selected = values.includes(option.value);
  env.world.onWorldInfoChange('__notSlashCommand__');
  // 原生世界书模块延迟把选中列表写回 world_info；本次一起保存，避免核验或刷新读到旧挂载。
  const worldSettings = env.world.world_info || env.world.getWorldInfoSettings?.().world_info;
  if (worldSettings) worldSettings.globalSelect = selectedSnapshotWorlds(env);
  // 仅通知 Select2 更新选择外观，避免重复触发酒馆挂载处理。
  globalThis.jQuery?.(select)?.trigger?.('change.select2');
}

// 同步当前预设的所有活动副本和已存在的待保存副本，不创建或清除其他预设的待保存任务。
function patchSnapshotSwitches(env, plan, orderCharacterId) {
  const undo = [];
  const changed = new WeakSet();
  const write = (object, enabled) => {
    if (!object || changed.has(object) || object.enabled === enabled) return;
    changed.add(object);
    const before = object.enabled, had = Object.hasOwn(object, 'enabled');
    undo.push(() => {if(object.enabled!==enabled)return;if (had) object.enabled = before; else delete object.enabled;});
    object.enabled = enabled;
  };
  const entries = new Map(plan.entries.map(item => [item.identifier, item.enabled]));
  const groups = new Map(plan.groups.map(item => [item.id, item.enabled]));
  const patchOrder = lists => {
    for (const node of Array.isArray(lists) ? lists : []) if (String(node?.character_id) === String(orderCharacterId)) {
      for (const item of node.order || []) if (entries.has(item?.identifier)) write(item, entries.get(item.identifier));
    }
  };
  const patchGroups = state => {for (const group of state?.groups || []) if (groups.has(String(group.id))) write(group, groups.get(String(group.id)));};
  const settings = env.openai.oai_settings, service = env.openai.promptManager?.serviceSettings;
  patchOrder(settings.prompt_order); patchOrder(service?.prompt_order);
  patchGroups(settings.extensions?.baibaiToolkit?.presetPromptGroups); patchGroups(service?.extensions?.baibaiToolkit?.presetPromptGroups);
  const bai = baiBaiState(), name = snapshotContext(env).presetName;
  if (bai?.presetPromptGroupRuntimePresetName === name) patchGroups(bai.presetPromptGroupRuntimeState);
  const vue = bai?.__baiBaiToolkitPresetVueListManager;
  patchOrder(vue?.pendingPresetPromptServiceSaves?.get?.(name)?.promptOrder);
  const pendingGroup = vue?.pendingPresetPromptGroupSaves?.get?.(name);
  patchGroups(pendingGroup?.groupState);
  if (pendingGroup) {
    const previous = pendingGroup.syncKey;
    undo.push(() => {pendingGroup.syncKey = previous;});
    pendingGroup.syncKey = `${name}:${JSON.stringify(pendingGroup.groupState)}`;
  }
  // Vue 可持有成员镜像；在重绘前同步，防止延迟排序保存重新带回旧开关。
  const patchItems = items => {
    for (const item of Array.isArray(items) ? items : []) {
      if (item.type === 'group') {
        if (groups.has(String(item.groupId))) {write(item, groups.get(String(item.groupId))); write(item.group, groups.get(String(item.groupId)));}
        patchItems(item.items);
      } else {
        const id = item.prompt?.identifier || item.identifier || item.id;
        if (entries.has(id)) {write(item, entries.get(id)); write(item.orderEntry, entries.get(id));}
      }
    }
  };
  patchItems(vue?.state?.items);
  return () => {for (const restore of undo.reverse()) restore();};
}

async function refreshSnapshotPrompts(env) {
  if (snapshotPresetLoads > 0) {
    const error = new Error('预设正在重新加载，请完成后重新应用快照');
    error.name = 'SnapshotContextChanged';
    throw error;
  }
  // 这里只重绘开关（柏宝箱也通过 render hook 同步列表）。原生切换已发出生命周期事件；
  // 再发 AFTER 会让刚启动的预设脚本执行离开预设的清理，移除悬浮入口但仍显示启用。
  await env.openai.promptManager?.render?.(false);
}

async function applySettingsSnapshot(env, snapshot, payload, automatic = false) {
  snapshot=selectSnapshotScope(snapshot);
  if(snapshot.resources)snapshot={...snapshot,resources:normalizeSnapshotResources(snapshot.resources)};
  validateSnapshot(snapshot);
  const included=snapshotScope(snapshot);
  const context = snapshotContext(env);
  assertSnapshotContext(env, payload.contextKey);
  await waitSnapshotPreset(env, context);
  const current = included.preset ? snapshotSettings(env) : {settings:env.openai.oai_settings};
  assertSnapshotIdle(env);
  const targetName = included.preset ? snapshot.presetName : context.presetName;
  const targetPreset = included.preset ? readPresetByName(env.manager, targetName) : current.settings;
  if (included.preset && !targetPreset) throw new Error('找不到预设「'+snapshot.presetName+'」，请更新快照');
  // 先在当前/目标数据上验证节点，不能先切换预设再发现这份快照不可恢复。
  planSnapshotRestore(snapshot, {settings: context.presetName === snapshot.presetName ? current.settings : targetPreset, orderCharacterId: current.orderCharacterId, groupState: null, worldNames: env.world.world_names});
  const allWorldNames=snapshot.resources ? [...new Set(Object.values(snapshot.resources.worlds).flat())] : snapshot.worldNames;
  const missingWorldNames = allWorldNames.filter(name => !env.world.world_names.includes(name));
  if (missingWorldNames.length && !payload.allowMissingWorlds) {
    if (automatic) throw new Error('快照「'+snapshot.name+'」缺少世界书：'+missingWorldNames.join('、')+'；已保留当前设置');
    return {warnings: [], needsConfirmation: true, missingWorldNames};
  }
  if (included.worlds && !document.getElementById('world_info')) throw new Error('全局世界书列表尚未就绪');
  const prepared=await prepareSnapshotResources(env,snapshot,context,payload.allowMissingWorlds);
  await settleBaiBai(env, context);
  await selectSnapshotPreset(env, targetName, context.scope);
  const target = snapshotContext(env);
  await waitSnapshotPreset(env, target);
  await settleBaiBai(env, target);
  const {settings, orderCharacterId} = included.preset ? snapshotSettings(env) : {settings:env.openai.oai_settings};
  const plan = planSnapshotRestore(snapshot, {settings, orderCharacterId, groupState: snapshotGroups(env), worldNames: env.world.world_names});
  assertSnapshotIdle(env);
  const worldsBefore = selectedSnapshotWorlds(env);
  assertSnapshotScope(env, context.scope, targetName);
  const undo = included.preset ? patchSnapshotSwitches(env, plan, orderCharacterId) : () => {};
  const journal=[];
  let resourceWarnings=[],worldsApplied=false;
  try {
    resourceWarnings=await applySnapshotResources(env,prepared,target,journal);
    assertSnapshotScope(env,context.scope,targetName);
    if (included.worlds) {setSnapshotWorlds(env, plan.worldNames);worldsApplied=true;}
    await saveSnapshotSettings(env, true);
    assertSnapshotScope(env, context.scope, targetName);
    if (included.preset) await refreshSnapshotPrompts(env);
    assertSnapshotScope(env, context.scope, targetName);
  } catch (error) {
    for (const rollback of journal.reverse()) {try {await rollback();} catch {error.message+='；部分资源恢复失败，请检查世界书和正则';}}
    if (journal.length && error.name==='SnapshotContextChanged') error.name='SnapshotPartialApply';
    undo();
    try {
      if(worldsApplied&&JSON.stringify(selectedSnapshotWorlds(env))===JSON.stringify(plan.worldNames))setSnapshotWorlds(env,worldsBefore);
      const rollbackContext=snapshotContext(env);await waitSnapshotPreset(env,rollbackContext);
      await saveSnapshotSettings(env,true);
      if(included.preset&&rollbackContext.scope===context.scope&&rollbackContext.presetName===targetName)await refreshSnapshotPrompts(env);
    } catch {error.message += '；恢复未完成，请检查当前开关';}
    throw error;
  }
  const warnings = resourceWarnings;
  if (plan.missingEntries.length) warnings.push('已跳过不存在的条目：'+plan.missingEntries.join('、'));
  if (plan.missingGroups.length) warnings.push('分组未能恢复（未安装柏宝箱或分组已变更）：'+plan.missingGroups.join('、'));
  if (snapshot.groups.length && env.extensions.extension_settings.baiBaiToolkit?.presetGroupingEnabled === false && !nativeGroupController?.owns('preset')) warnings.push('柏宝箱的预设分组功能已关闭，分组总开关暂不参与生成');
  if (missingWorldNames.length) warnings.push('未挂载缺失世界书：'+missingWorldNames.join('、'));
  return {warnings};
}

// Called only inside the shared queue; invoke low-level operations to avoid recursive binding/queue deadlock.
async function applyLinkedSnapshot(env, snapshot, payload, automatic = false) {
  const link = (env.extensions.extension_settings[API_BINDINGS_KEY] || []).find(item=>item.snapshotId===snapshot.id);
  if (!link) return applySettingsSnapshot(env,snapshot,payload,automatic);
  const scope = snapshotContext(env).scope;
  await handleApiManagerRequest('api-manager-preflight', {id:link.apiId, mode:'both'});
  const result = await applySettingsSnapshot(env,snapshot,payload,automatic);
  if (result.needsConfirmation) return result;
  try {
    assertSnapshotScope(env, scope);
    const api = await handleApiManagerRequest('api-manager-apply', {id:link.apiId, mode:'both'});
    if (!api.connection.ok) result.warnings.push(api.connection.message);
    return {...result, ...api};
  } catch (error) {
    throw new Error('快照已应用，但绑定 API 未完成：'+error.message+'。请核对当前设置后重试');
  }
}

async function handleSnapshotRequest(method, payload) {
  if (method === 'snapshot-list') {await snapshotQueue; return snapshotList(await snapshotEnvironment());}
  if (['snapshot-editor','snapshot-draft-preset','snapshot-draft-worlds'].includes(method)) {await snapshotQueue;return readSnapshotEditor(await snapshotEnvironment(),payload);}
  return snapshotSerial(async () => {
    const env = await snapshotEnvironment(), store = snapshotStore(env);
    const context = snapshotContext(env);
    const existing = store.snapshots.find(item => item.id === payload.id);
    if (method === 'snapshot-apply') {
      if (!existing) throw new Error('快照已删除，请刷新列表');
      assertSnapshotContext(env, payload.contextKey);
      snapshotAutoPending = false;
      snapshotAutoToken++;
      return applyLinkedSnapshot(env, existing, payload);
    }
    if (method === 'snapshot-save' || method === 'snapshot-save-draft') {
      assertSnapshotContext(env, payload.contextKey);
      if (payload.id && !existing) throw new Error('快照已删除，请重新保存');
      await waitSnapshotPreset(env, context);
      await settleBaiBai(env, context);
      assertSnapshotContext(env, payload.contextKey);
      assertSnapshotIdle(env);
      // 覆盖当前设置沿用目标快照的范围；只有详情编辑才显式修改已有范围。
      const included=method==='snapshot-save'&&existing ? snapshotScope(existing) : snapshotScope({scope:method==='snapshot-save-draft' ? payload.draft?.scope : payload.scope,resources:{}});
      const {settings, orderCharacterId} = included.preset ? snapshotSettings(env) : {settings:env.openai.oai_settings,orderCharacterId:null};
      let snapshot;
      if (method==='snapshot-save-draft') {
        snapshot=selectSnapshotScope({...clone(payload.draft),scope:included});
        if (!snapshot || typeof snapshot!=='object') throw new Error('快照草稿无效');
        snapshot.id=existing?.id || createIdentifier();snapshot.name=normalizeSnapshotName(payload.name);
        snapshot.createdAt=existing?.createdAt || Date.now();snapshot.updatedAt=Date.now();
        snapshot.resources=normalizeSnapshotResources(snapshot.resources);
        // 只保留快照字段，不持久化前端携带的预览正文或分组归属。
        snapshot=Object.fromEntries(['id','name','presetName','orderCharacterId','createdAt','updatedAt','entries','groups','worldNames','resources','scope'].map(key=>[key,snapshot[key]]));
        snapshot.entries=snapshot.entries.map(({identifier,name,enabled})=>({identifier,name,enabled}));
        snapshot.groups=snapshot.groups.map(({id,name,enabled})=>({id,name,enabled}));
        snapshot.worldNames=[...snapshot.resources.worlds.global];
        validateSnapshot(snapshot);
        const preset=readPresetByName(env.manager,snapshot.presetName);
        if(included.preset&&!preset)throw new Error('所选预设不存在');
        planSnapshotRestore(snapshot,{settings:preset,orderCharacterId,groupState:null,worldNames:env.world.world_names});
        if (!context.canBindCharacter && snapshot.resources.regex.character.length) throw new Error('请先打开角色再保存角色正则');
      } else {
        snapshot = included.preset ? captureSnapshot({id: existing?.id, name: payload.name, presetName: context.presetName, settings, orderCharacterId, groupState: snapshotGroups(env), worldNames: included.worlds ? selectedSnapshotWorlds(env) : []}) : {id:existing?.id||createIdentifier(),name:normalizeSnapshotName(payload.name),presetName:context.presetName,orderCharacterId:null,entries:[],groups:[],createdAt:Date.now(),updatedAt:Date.now()};
        snapshot.scope=included;
        snapshot.resources=await snapshotCaptureResources(env,context,included);
        snapshot.worldNames=[...snapshot.resources.worlds.global];
        validateSnapshot(snapshot);
      }
      assertSnapshotContext(env,payload.contextKey);
      if (existing) snapshot.createdAt = existing.createdAt;
      const previous = store.snapshots;
      store.snapshots = existing ? previous.map(s => s.id === existing.id ? snapshot : s) : [...previous, snapshot];
      try {await saveSnapshotSettings(env);} catch (error) {store.snapshots = previous; throw error;}
    } else if (method === 'snapshot-rename') {
      if (!existing) throw new Error('快照已删除');
      const previous = existing.name;
      existing.name = normalizeSnapshotName(payload.name);
      try {await saveSnapshotSettings(env);} catch (error) {existing.name = previous; throw error;}
    } else if (method === 'snapshot-delete') {
      if (!existing) throw new Error('快照已删除');
      const before = clone(store);
      const previousLinks = env.extensions.extension_settings[API_BINDINGS_KEY];
      env.extensions.extension_settings[API_BINDINGS_KEY] = (previousLinks || []).filter(link=>link.snapshotId!==payload.id);
      store.snapshots = store.snapshots.filter(s => s.id !== payload.id);
      for (const key of Object.keys(store.characterBindings)) if (store.characterBindings[key] === payload.id) delete store.characterBindings[key];
      try {await saveSnapshotSettings(env);} catch (error) {Object.assign(store, before); env.extensions.extension_settings[API_BINDINGS_KEY]=previousLinks; throw error;}
      // 其他聊天的引用在加载时视为失效；不遍历或改写用户的聊天文件。
    } else if (method === 'snapshot-bind') {
      assertSnapshotContext(env, payload.contextKey);
      if (payload.id !== null && !existing) throw new Error('快照已删除');
      if (payload.target === 'character') {
        if (!context.canBindCharacter) throw new Error('请先打开一个角色');
        const before = store.characterBindings[context.characterKey];
        if (payload.id === null) delete store.characterBindings[context.characterKey];
        else Object.defineProperty(store.characterBindings, context.characterKey, {value: payload.id, writable: true, configurable: true, enumerable: true});
        try {await saveSnapshotSettings(env);} catch (error) {if (before === undefined) delete store.characterBindings[context.characterKey]; else store.characterBindings[context.characterKey] = before; throw error;}
      } else if (payload.target === 'chat') {
        if (!context.canBindChat) throw new Error('请先打开并保存当前聊天');
        const metadata = env.script.chat_metadata || globalThis.SillyTavern?.getContext?.().chatMetadata;
        const before = metadata[SNAPSHOT_KEY];
        if (payload.id === null) delete metadata[SNAPSHOT_KEY];
        else metadata[SNAPSHOT_KEY] = {snapshotId: payload.id};
        try {await saveSnapshotMetadata(env, context, metadata);} catch (error) {if (before === undefined) delete metadata[SNAPSHOT_KEY]; else metadata[SNAPSHOT_KEY] = before; throw error;}
      } else throw new Error('无效绑定目标');
    } else throw new Error('未知快照操作');
    const result = snapshotList(env); result.busy = false;
    return result;
  });
}

async function installSnapshotBindings(controller) {
  if (snapshotInstalled) return;
  const script = await import('/script.js');
  if (!script.eventSource?.on) return;
  snapshotInstalled = true;
  snapshotNotify = () => controller.sendEvent('snapshots-changed');
  const before = script.event_types?.OAI_PRESET_CHANGED_BEFORE;
  const after = script.event_types?.OAI_PRESET_CHANGED_AFTER;
  const first = (name, handler) => (script.eventSource.makeFirst || script.eventSource.on).call(script.eventSource, name, handler);
  if (before && after) {
    // 原生先改预设名称再异步加载字段；最高优先级记录加载区间，名称相同也必须等待。
    first(before, () => {snapshotPresetLoads++;});
    first(after, () => {
      snapshotPresetLoads = Math.max(0, snapshotPresetLoads - 1);
      if (snapshotPresetLoads === 0) {for (const resolve of snapshotPresetWaiters) resolve(); snapshotPresetWaiters.clear();}
    });
  }
  const schedule = (newContext = false) => {
    if (newContext) {snapshotEpoch++; snapshotAutoToken++; snapshotAutoPending = true; snapshotNotify();}
    clearTimeout(snapshotAutoTimer);
    snapshotAutoTimer = setTimeout(run, 100);
  };
  const run = async () => {
    if (!snapshotAutoPending) return;
    if (script.isGenerating?.() || script.is_send_press) {snapshotAutoTimer = setTimeout(run, 500); return;}
    snapshotAutoPending = false;
    const token = snapshotAutoToken;
    try {
      const env = await snapshotEnvironment(), context = snapshotContext(env);
      if (!context.canBindChat) return;
      const binding = resolveSnapshotBinding(snapshotStore(env), context.chatBindingId, context.characterKey);
      if (!binding) return;
      await snapshotSerial(async () => {
        if (token !== snapshotAutoToken) return;
        assertSnapshotScope(env, context.scope);
        const latestContext = snapshotContext(env);
        const latest = resolveSnapshotBinding(snapshotStore(env), latestContext.chatBindingId, latestContext.characterKey);
        if (!latest) return;
        const result = await applyLinkedSnapshot(env, latest.snapshot, {contextKey: latestContext.key}, true);
        if (result.warnings.length) globalThis.toastr?.warning?.(result.warnings.join('\n'), '设置快照');
        else globalThis.toastr?.success?.('已应用「'+latest.snapshot.name+'」', '设置快照');
      });
    } catch (error) {
      if (error.name === 'SnapshotGenerationActive' && token === snapshotAutoToken) {snapshotAutoPending = true; schedule();}
      else if (error.name !== 'SnapshotContextChanged') globalThis.toastr?.warning?.(error.message, '设置快照未应用');
    }
  };
  for (const name of ['CHAT_CHANGED', 'APP_READY']) if (script.event_types?.[name]) script.eventSource.on(script.event_types[name], () => schedule(true));
  for (const name of ['GENERATION_ENDED', 'GENERATION_STOPPED']) if (script.event_types?.[name]) script.eventSource.on(script.event_types[name], () => {if (snapshotAutoPending) schedule();});
  snapshotAutoPending = true;
  schedule();
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || '',
  };
}

function applyImportantStyles(element, styles) {
  for (const [property, value] of Object.entries(styles)) element.style.setProperty(property, value, 'important');
}

function createHostDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = `${APP_ID}-host`;
  dialog.setAttribute('aria-label', APP_TITLE);
  applyImportantStyles(dialog, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100dvh',
    'max-width': 'none',
    'max-height': 'none',
    margin: '0',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    background: '#282828',
    color: '#ebdbb2',
  });

  const iframe = document.createElement('iframe');
  iframe.id = `${APP_ID}-frame`;
  iframe.title = APP_TITLE;
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  applyImportantStyles(iframe, {
    display: 'block',
    width: '100%',
    height: '100%',
    margin: '0',
    padding: '0',
    border: '0',
    background: 'transparent',
  });
  dialog.append(iframe);
  document.body.append(dialog);
  return { dialog, iframe };
}

class AppHost {
  constructor() {
    this.dialog = null;
    this.iframe = null;
    this.port = null;
    this.uiReady = false;
    this.openRequested = false;
    this.tavernEventsBound = false;
    this.environmentBound = false;
    this.ttKeyboard = 0;
    this.surfaceKeyboard = 0;
    this.ttSafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.environmentFrame = 0;
    this.scheduleEnvironment = () => {};
    this.tauriLayoutCleanup = null;
  }

  open(apiQuick = false) {
    this.apiQuick = apiQuick;
    this.openRequested = true;
    if (!this.dialog?.isConnected) this.mount();
    try {
      if (!this.dialog.open) this.dialog.showModal();
    } catch (error) {
      console.error(`[${APP_ID}] open host dialog failed`, error);
      this.dialog.setAttribute('open', '');
    }
    applyImportantStyles(this.dialog, apiQuick ? {width:'min(600px, 96vw)',height:'min(780px, 92dvh)',margin:'auto','border-radius':'16px'} : {width:'100vw',height:'100dvh',margin:'0','border-radius':'0'});
    if (this.uiReady) this.sendEvent('open', {apiQuick:this.apiQuick});
  }

  close() {
    this.openRequested = false;
    if (!this.dialog?.open) return;
    try {
      this.dialog.close();
    } catch {
      this.dialog.removeAttribute('open');
    }
  }

  mount() {
    const mounted = createHostDialog();
    this.dialog = mounted.dialog;
    this.iframe = mounted.iframe;
    let backdropPointer = false;
    const outside = event => {
      const rect = this.dialog.getBoundingClientRect();
      return event.target === this.dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    };
    this.dialog.addEventListener('pointerdown', event => { backdropPointer = outside(event); });
    this.dialog.addEventListener('click', event => {
      if (this.apiQuick && backdropPointer && outside(event)) this.close();
      backdropPointer = false;
    });
    this.dialog.addEventListener('close', () => {
      this.openRequested = false;
      this.sendEvent('host-closed');
    });
    this.bindEnvironment();
    this.bindTavernEvents();
    this.prepareIframe();
  }

  async prepareIframe() {
    this.iframe.addEventListener('load', () => this.connect());
    const tauriSetup = this.configureTauriSurface();
    if (tauriSetup) {
      // TauriTavern is an optional enhancement. Never let its adapter block the
      // standard SillyTavern iframe from loading if the host ABI is unavailable.
      await Promise.race([
        tauriSetup,
        new Promise(resolve => setTimeout(resolve, 1_200)),
      ]);
    } else {
      // A late-injected Tauri ABI still gets one non-blocking chance after the
      // standard iframe has started; on normal SillyTavern this remains a no-op.
      setTimeout(() => this.configureTauriSurface(), 1_500);
    }
    this.iframe.src = new URL('../ui/index.html', import.meta.url).href;
  }

  // TT 布局快照统一处理：layout-kit 与硬 ABI 两条订阅路径共用，转发键盘高度与安全区。
  applyTauriLayoutSnapshot(snapshot) {
    const keyboard = snapshot?.ime?.keyboardOffset;
    if (Number.isFinite(keyboard)) this.ttKeyboard = Math.max(0, keyboard);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const inset = snapshot?.safeInsets?.[side];
      if (Number.isFinite(inset)) this.ttSafeInsets[side] = Math.max(0, inset);
    }
    this.scheduleEnvironment();
  }

  configureTauriSurface() {
    if (!globalThis.__TAURITAVERN__) return null;
    return (async () => {
      // 首选官方 layout-kit（新 TT 提供）。旧版 TT 没有该文件（import 404 抛错），
      // 必须回退到硬 ABI：__TAURITAVERN__.api.layout.subscribe 是旧版 TT 唯一存在的
      // 键盘高度通道——只依赖 layout-kit 会让旧版 TT 的输入法适配整个失效。
      try {
        const layoutKit = await import('/scripts/tauritavern/layout-kit.js');
        await layoutKit.waitForHostReady?.();
        if (layoutKit.applySurface && layoutKit.SURFACE?.ViewportHost) {
          layoutKit.applySurface(this.iframe, layoutKit.SURFACE.ViewportHost);
        } else {
          this.iframe.dataset.ttMobileSurface = 'viewport-host';
        }
        if (layoutKit.subscribeLayout) {
          this.tauriLayoutCleanup = await layoutKit.subscribeLayout(
            snapshot => this.applyTauriLayoutSnapshot(snapshot),
          );
        }
      } catch (error) {
        console.warn(`[${APP_ID}] TauriTavern layout-kit unavailable, falling back to raw layout API`, error);
        try {
          await (globalThis.__TAURITAVERN__.ready ?? globalThis.__TAURITAVERN_MAIN_READY__);
          this.iframe.dataset.ttMobileSurface = 'viewport-host';
          const layout = globalThis.__TAURITAVERN__.api?.layout;
          if (layout && typeof layout.subscribe === 'function') {
            this.tauriLayoutCleanup = await layout.subscribe(
              snapshot => this.applyTauriLayoutSnapshot(snapshot),
            );
          } else {
            console.warn(`[${APP_ID}] TauriTavern layout API unavailable; IME forwarding disabled`);
          }
        } catch (fallbackError) {
          console.warn(`[${APP_ID}] TauriTavern raw layout API failed`, fallbackError);
        }
      }
    })();
  }

  connect() {
    this.port?.close();
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.uiReady = false;
    this.port.onmessage = event => this.onPortMessage(event.data);
    this.port.start();
    this.iframe.contentWindow.postMessage({ type: CONNECT_MESSAGE }, POST_MESSAGE_TARGET, [channel.port2]);
  }

  async onPortMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'request') {
      const replyPort = this.port;
      try {
        const value = await handleRequest(message.method, message.payload);
        replyPort?.postMessage({ type: 'result', id: message.id, ok: true, value });
      } catch (error) {
        console.error(`[${APP_ID}] host request failed`, message.method, error);
        replyPort?.postMessage({ type: 'result', id: message.id, ok: false, error: serializeError(error) });
      }
      return;
    }
    if (message.type !== 'notify') return;
    if (message.name === 'ready') {
      this.uiReady = true;
      this.bindTavernEvents();
      this.sendEnvironment();
      if (this.openRequested) this.sendEvent('open', {apiQuick:this.apiQuick});
    } else if (message.name === 'close') {
      this.close();
    }
  }

  sendEvent(name, payload) {
    if (!this.port) return;
    this.port.postMessage({ type: 'event', name, payload });
  }

  bindTavernEvents() {
    if (this.tavernEventsBound) return;
    try {
      const context = globalThis.SillyTavern?.getContext?.();
      const eventSource = context?.eventSource || globalThis.eventSource;
      const eventTypes = context?.event_types || globalThis.event_types;
      if (!eventSource || !eventTypes?.PRESET_CHANGED || typeof eventSource.on !== 'function') return;
      eventSource.on(eventTypes.PRESET_CHANGED, data => {
        if (!data || (data.apiId && data.apiId !== 'openai') || !data.name) return;
        this.sendEvent('preset-changed', { apiId: data.apiId || 'openai', name: String(data.name) });
      });
      this.tavernEventsBound = true;
    } catch (error) {
      console.warn(`[${APP_ID}] SillyTavern preset event bridge unavailable`, error);
    }
  }

  bindEnvironment() {
    if (this.environmentBound) return;
    this.environmentBound = true;
    const schedule = () => {
      if (this.environmentFrame) return;
      this.environmentFrame = requestAnimationFrame(() => {
        this.environmentFrame = 0;
        this.sendEnvironment();
      });
    };
    this.scheduleEnvironment = schedule;
    window.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    // 活跃 IME 表面切换（data-tt-ime-active 只是布尔标记）或其内联 style 变化
    // （--tt-ime-bottom 由 TT 原生桥写在目标元素内联 style 上）都要重发环境快照。
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
    document.addEventListener('focusin', schedule, true);
    document.addEventListener('focusout', schedule, true);
  }

  environmentSnapshot() {
    const computed = getComputedStyle(document.documentElement);
    const theme = {};
    for (const variable of THEME_VARIABLES) {
      const value = computed.getPropertyValue(variable).trim();
      if (value) theme[variable] = value;
    }
    const cssKeyboard = Number.parseFloat(computed.getPropertyValue('--tt-viewport-bottom-inset'))
      || Number.parseFloat(computed.getPropertyValue('--tt-ime-bottom'))
      || 0;
    const visualKeyboard = window.visualViewport
      ? Math.max(0, window.innerHeight - window.visualViewport.height)
      : 0;
    /* Android TauriTavern 的 --tt-ime-bottom 是 surface-local：iframe 内聚焦时宿主 IME
       控制器在主 document 看到的 focusin 目标是 <iframe>（非可编辑元素），活跃表面被释放、
       布局订阅不再推送键盘高度，:root 上的 CSS 变量通道也为 0——键盘高度只由原生桥
       注入到默认 IME 目标元素的内联 style 上。因此直接从携带者读取：当前活跃 IME 表面
       （data-tt-ime-active）优先，#sheld 兜底（iframe 输入时的实际落点）。 */
    let surfaceKeyboard = 0;
    for (const carrier of [document.querySelector('[data-tt-ime-active]'), document.getElementById('sheld')]) {
      if (!carrier) continue;
      const value = Number.parseFloat(getComputedStyle(carrier).getPropertyValue('--tt-ime-bottom'));
      if (Number.isFinite(value)) surfaceKeyboard = Math.max(surfaceKeyboard, value);
    }
    this.surfaceKeyboard = surfaceKeyboard;
    const safeInsets = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const cssInset = Number.parseFloat(computed.getPropertyValue(`--tt-inset-${side}`)) || 0;
      safeInsets[side] = Math.max(0, this.ttSafeInsets[side] || 0, cssInset);
    }
    return {
      theme,
      safeInsets,
      keyboardOffset: Math.max(this.ttKeyboard, cssKeyboard, surfaceKeyboard, visualKeyboard),
      viewport: {
        width: window.visualViewport?.width || window.innerWidth,
        height: window.visualViewport?.height || window.innerHeight,
      },
    };
  }

  sendEnvironment() {
    const environment = this.environmentSnapshot();
    const background = environment.theme['--SmartThemeBlurTintColor'];
    const color = environment.theme['--SmartThemeBodyColor'];
    if (background) this.dialog?.style.setProperty('background', background, 'important');
    if (color) this.dialog?.style.setProperty('color', color, 'important');
    this.sendEvent('environment', environment);
  }
}

let apiEntrySync = null;
async function installApiEntries(controller) {
  const { extension_settings } = await import('/scripts/extensions.js');
  let preferences = extension_settings.preset_compare_api_entries || {};
  const qrId = APP_ID + '-api-qr', ballId = APP_ID + '-api-ball', railId = APP_ID + '-api-rail';
  let position = null, drag = null, moved = false;
  const make = (id, text) => {
    const button = document.createElement('button'); button.id = id; button.type = 'button'; button.textContent = text;
    button.title = '打开 API 快切'; button.setAttribute('aria-label', '打开 API 快切');
    applyImportantStyles(button, { display:'inline-flex', visibility:'visible', opacity:'1', 'align-items':'center', 'justify-content':'center',
      'box-sizing':'border-box', margin:'0', padding:'5px 10px', width:'auto', height:'30px', 'min-width':'0', 'min-height':'30px',
      border:'1px solid var(--SmartThemeBorderColor, #888)', 'border-radius':'8px', background:'var(--SmartThemeBlurTintColor, #333)',
      color:'var(--SmartThemeBodyColor, #eee)', font:'13px system-ui', 'white-space':'nowrap', cursor:'pointer', 'pointer-events':'auto' });
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (id === ballId && moved) { moved = false; return; }
      controller.open(true);
    }); return button;
  };
  const placeBall = () => {
    const button = document.getElementById(ballId); if (!button) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const x = Math.max(left + 8, Math.min(left + width - 56, position?.x ?? left + width - 64));
    const y = Math.max(top + 8, Math.min(top + height - 56, position?.y ?? top + height - 160));
    applyImportantStyles(button, {left:x+'px', top:y+'px', right:'auto', bottom:'auto'});
  };
  const syncQrVisibility = () => {
    const qr = document.getElementById(qrId), rail = document.getElementById(railId);
    if (!qr || !rail) return;
    const hidden = document.body.classList.contains('qra-enabled') && qr.classList.contains('qrq-hidden-by-plugin') && !qr.classList.contains('qrq-whitelisted-original');
    const display = hidden ? 'none' : 'flex';
    if (rail.style.display !== display) rail.style.setProperty('display', display, 'important');
  };
  const visibilityObserver = new MutationObserver(syncQrVisibility);
  visibilityObserver.observe(document.body, {attributes:true, attributeFilter:['class'], subtree:true});
  const sync = () => {
    // QR Assistant's public third-party registry (uhhhh15/QR); preserve all other extensions' entries.
    if (!window.qrAssistantExtensionApi) window.qrAssistantExtensionApi = [];
    const registry = window.qrAssistantExtensionApi;
    if (Array.isArray(registry)) {
      const index = registry.findIndex(entry=>entry.dom_id===qrId);
      if (preferences.quickReply && index < 0) registry.push({dom_id:qrId, group_name:'酒馆盒子', button_name:'API / 设置快照'});
      if (!preferences.quickReply && index >= 0) registry.splice(index,1);
    }
    if (!preferences.quickReply) document.getElementById(railId)?.remove();
    else {
      const form = document.getElementById('send_form');
      if (form && !document.getElementById(railId)) {
        // Own a separate row: native QR visibility/popout/rebuild must not hide this extension's entry.
        const rail = document.createElement('div'); rail.id = railId;
        applyImportantStyles(rail, {display:'flex', visibility:'visible', opacity:'1', 'justify-content':'center',
          'flex':'0 0 100%', 'grid-column':'1 / -1', order:'-1', width:'100%', 'min-height':'34px', padding:'2px', position:'relative', 'box-sizing':'border-box'});
        rail.append(make(qrId, 'API快切')); form.prepend(rail);
      }
    }
    if (!preferences.floating) { document.getElementById(ballId)?.remove(); position = null; }
    else if (!document.getElementById(ballId)) {
      const button = make(ballId, 'API');
      applyImportantStyles(button, {position:'fixed', width:'48px', height:'48px', 'border-radius':'50%', 'z-index':'29999',
        'box-shadow':'0 3px 12px #0004', 'touch-action':'none', transform:'none', 'max-width':'48px', 'max-height':'48px'});
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const rect = button.getBoundingClientRect(); drag = { x:event.clientX, y:event.clientY, left:rect.left, top:rect.top }; moved = false;
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener('pointermove', event => {
        if (!drag) return;
        const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
        if (Math.hypot(dx,dy)>5) moved = true;
        if (moved) { position = {x:drag.left+dx,y:drag.top+dy}; placeBall(); }
      });
      button.addEventListener('pointerup', () => {drag=null;});
      button.addEventListener('pointercancel', () => {drag=null;moved=false;});
      document.body.append(button); placeBall();
    }
  };
  apiEntrySync = next => { preferences=next; sync(); syncQrVisibility(); };
  const observer = new MutationObserver(() => {if(preferences.quickReply||preferences.floating) sync();});
  observer.observe(document.body, {childList:true,subtree:true});
  window.addEventListener('resize', placeBall);
  window.visualViewport?.addEventListener('resize', placeBall);
  window.visualViewport?.addEventListener('scroll', placeBall);
  sync();
}

function addMenu(controller) {
  const menu = document.getElementById('extensionsMenu');
  if (!menu || document.getElementById(`${APP_ID}-button`)) return false;
  const entry = document.createElement('div');
  entry.id = `${APP_ID}-button`;
  entry.className = 'list-group-item flex-container flexGap5 interactable';
  entry.tabIndex = 0;
  const icon = document.createElement('span');
  icon.className = 'fa-solid fa-code-compare';
  const label = document.createElement('span');
  label.textContent = APP_TITLE;
  entry.append(icon, label);
  const open = () => controller.open();
  entry.addEventListener('click', open);
  entry.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  menu.append(entry);
  return true;
}

export function installPresetCompareHost() {
  const controller = new AppHost();
  void installNativeGroupControls().catch(error => console.warn(`[${APP_ID}] native groups unavailable`, error));
  void installApiEntries(controller).catch(error => console.warn(`[${APP_ID}] API entries unavailable`, error));
  void installApiQuickCommand().catch(error => console.warn(`[${APP_ID}] API quick command unavailable`, error));
  void installSnapshotBindings(controller).catch(error => console.warn(`[${APP_ID}] snapshot bindings unavailable`, error));
  const installMenu = () => {
    if (addMenu(controller)) return;
    const observer = new MutationObserver(() => {
      if (addMenu(controller)) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMenu, { once: true });
  else installMenu();
  return controller;
}

async function installNativeGroupControls() {
  const [openai, script, extensions, regex, presetManager] = await Promise.all([
    import('/scripts/openai.js'), import('/script.js'), import('/scripts/extensions.js'),
    import('/scripts/extensions/regex/engine.js'), import('/scripts/preset-manager.js'),
  ]);
  const select = data => ({
    preferences: data.extension_settings?.preset_compare_native_groups || null,
    regexGroups: data.extension_settings?.baiBaiToolkit?.regexListGroups || null,
    globalRegex: data.extension_settings?.regex || [],
    presetGroups: data.oai_settings?.extensions?.baibaiToolkit || null,
  });
  // JSON 对象键序不是保存内容；后端重排键后仍应通过，数组顺序和字段值继续严格核验。
  const fingerprint = data => JSON.stringify(select(data), (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
  const saveSettingsChecked = async () => {
    const expected = fingerprint({ extension_settings: extensions.extension_settings, oai_settings: openai.oai_settings });
    await script.saveSettings();
    const result = await readSnapshotPersistence({ script }, '/api/settings/get', {});
    const persisted = typeof result?.settings === 'string' ? JSON.parse(result.settings) : result?.settings;
    if (fingerprint(persisted || {}) !== expected) throw new Error('未确认分组设置已保存，请检查连接后重试');
  };
  const start = () => { nativeGroupController = installNativeGroups({ openai, script, extensions, regex, presetManager, serial: snapshotSerial, saveSettingsChecked }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

async function installApiQuickCommand() {
  const [{ SlashCommandParser }, { SlashCommand }, { SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE }] = await Promise.all([
    import('/scripts/slash-commands/SlashCommandParser.js'), import('/scripts/slash-commands/SlashCommand.js'), import('/scripts/slash-commands/SlashCommandArgument.js'),
  ]);
  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'box-api',
    callback: async (args, value) => {
      await handleRequest('api-manager-apply', { id: String(value || '').trim(), mode: String(args.mode || 'both') });
      return '';
    },
    namedArgumentList: [SlashCommandNamedArgument.fromProps({ name: 'mode', description: 'api 仅切 API / model 仅切模型 / both 两者', typeList: [ARGUMENT_TYPE.STRING], defaultValue: 'both' })],
    unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '酒馆盒子 API 方案 ID', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
    helpString: '切换酒馆盒子的自定义兼容 API 方案，保留预设、正则、世界书及生成参数。可用于原生快速回复按钮。',
  }));
}

// 扩展更新 hook（ST 官方约定，manifest.hooks.update 指向本导出）：
// ST 在「扩展更新」成功后调用，扩展自行决定收尾。这里直接整页刷新，
// 让酒馆重新加载入口/宿主/iframe 全部脚本——比手动 F5 更可靠（无旧模块缓存），
// 也与 JS-Slash-Runner 的「更新成功后刷新页面以生效」同款行为。
export async function reloadAfterUpdate() {
  location.reload();
}
