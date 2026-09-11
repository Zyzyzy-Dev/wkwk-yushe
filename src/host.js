// 预设更新编辑器 · 酒馆宿主桥：唯一可接触 SillyTavern 主 document/API 的模块。
// 扩展菜单入口、外层 dialog/iframe 外壳、preset-manager/openai 动态读取与保存、
// PRESET_CHANGED 订阅转发、主题变量与 TauriTavern IME 高度转发。
import { applyPresetToMemory, shouldRefreshActivePreset } from './core.js';
import { captureSnapshot, normalizeSnapshotName, planSnapshotRestore, resolveSnapshotBinding, snapshotOrder, validateSnapshot, snapshotPresetEditor, snapshotScope, selectSnapshotScope } from './snapshot.js';
import { captureWorldEntries, restoreWorldEntries, captureRegexSwitches, restoreRegexSwitches, validateSnapshotResources, normalizeSnapshotResources, regexEditor } from './snapshot-resources.js';
import { createIdentifier } from './core.js';
import { normalizeWorkbenchBook } from './worldbook-workbench.js';

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

const clone = value => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

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

async function workbenchDiskNames(env) {
  const data = await readSnapshotPersistence(env, '/api/settings/get', {});
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
  const names = await workbenchDiskNames(env);
  if (method === 'workbench-read-worldbook') {
    if (!names.includes(name)) throw new Error('该世界书不存在，请重新读取列表');
    const book = await readSnapshotPersistence(env, '/api/worldinfo/get', {name});
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
  if (!scope.regex) resources.regex={global:[],preset:[],character:[]};
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
  if (!draft.scope.regex) draft.resources.regex=Object.fromEntries(Object.entries(snapshotRegexSources(env,preset)).map(([scope,scripts])=>[scope,captureRegexSwitches(scripts)]));
  const groups=draft.presetName===context.presetName?snapshotGroups(env):preset.extensions?.baibaiToolkit?.presetPromptGroups;
  const editor={...snapshotPresetEditor(draft,preset,groups),regex:{},regexGroups:{}};
  for(const [scope,scripts] of Object.entries(snapshotRegexSources(env,preset))){
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

async function readSnapshotPersistence(env, url, body) {
  const getHeaders = env.script.getRequestHeaders || globalThis.SillyTavern?.getContext?.().getRequestHeaders;
  if (typeof getHeaders !== 'function') throw new Error('酒馆未提供保存核验接口，请更新酒馆后重试');
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch(url, {method: 'POST', headers: getHeaders(), body: JSON.stringify(body), cache: 'no-cache', signal: abort.signal});
    if (!response.ok) throw new Error('保存后读取失败，请检查服务器连接');
    return await response.json();
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
  for(const scope of ['global','preset','character']){
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
  for (const scope of ['global','preset','character']) {
    regexPlans[scope]=restoreRegexSwitches(resources.regex[scope],sources[scope]);
    if (regexPlans[scope].missing.length) warnings.push('已跳过缺失的'+({global:'全局',preset:'预设',character:'角色'}[scope])+'正则：'+regexPlans[scope].missing.join('、'));
  }
  const previousGlobal=clone(sources.global), previousPreset=clone(sources.preset);
  journal.push(async()=>{
    // 回滚持有的原始记录引用，不把整个新聊天/新预设设置替换成旧副本。
    // 正则只有两种状态：若已被外部改回原值，不再写入。
    if(env.extensions.extension_settings.regex===sources.global)rollbackSnapshotRegexArray(sources.global,previousGlobal,regexPlans.global.scripts,'global');
    if(env.openai.oai_settings.extensions?.regex_scripts===sources.preset)rollbackSnapshotRegexArray(sources.preset,previousPreset,regexPlans.preset.scripts,'preset');

  });
  syncSnapshotRegexCaches(env,context,regexPlans,journal);
  env.extensions.extension_settings.regex=patchSnapshotRegexArray(sources.global,regexPlans.global.scripts,'global');
  env.openai.oai_settings.extensions ??= {};env.openai.oai_settings.extensions.regex_scripts=patchSnapshotRegexArray(sources.preset,regexPlans.preset.scripts,'preset');
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
  const character=snapshotCharacter(env);
  if (included.regex && character && JSON.stringify(sources.character)!==JSON.stringify(regexPlans.character.scripts)) {
    guard();const before=clone(sources.character);
    journal.push(async()=>{
      const current=await readSnapshotPersistence(env,'/api/characters/get',{avatar_url:character.avatar});
      const scripts=current?.data?.extensions?.regex_scripts || [];
      if(JSON.stringify(scripts)!==JSON.stringify(before)&&JSON.stringify(scripts)!==JSON.stringify(regexPlans.character.scripts))throw new Error('角色正则已被外部修改，保留新内容');
      await writeSnapshotCharacterRegex(env,character,before);
    });
    await writeSnapshotCharacterRegex(env,character,regexPlans.character.scripts);guard();
  }
  if (included.regex) warnings.push(...snapshotContext(env).regexAuthorization);
  return warnings;
}

function snapshotSerial(action) {
  const run = snapshotQueue.then(async () => {
    snapshotBusy++;
    try { return await action(); }
    finally { snapshotBusy--; snapshotNotify(); }
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

async function selectSnapshotPreset(env, name, scope, preserveRegex = false) {
  if (snapshotContext(env).presetName === name) return;
  const {preset_names: names} = env.manager.getPresetList();
  const value = Array.isArray(names) ? names.indexOf(name) : (Object.hasOwn(names || {}, name) ? names[name] : undefined);
  if (value === undefined || value === -1) throw new Error('找不到预设「'+name+'」，请更新快照');
  const events = env.script.eventSource, type = env.script.event_types?.OAI_PRESET_CHANGED_AFTER;
  if (!events?.on || !type || !env.manager.selectPreset) throw new Error('当前酒馆不支持等待预设切换，请手动选择预设后重试');
  const beforeType=env.script.event_types?.OAI_PRESET_CHANGED_BEFORE;
  if (preserveRegex && !beforeType) throw new Error('当前酒馆无法在切换预设时保留正则，请更新酒馆后重试');
  const originalRegex=preserveRegex ? clone(env.openai.oai_settings.extensions?.regex_scripts || []) : null;
  const originalGroups=preserveRegex ? clone(snapshotRegexGroups(env,'preset',snapshotContext(env).presetName,env.openai.oai_settings)) : null;
  const allowed=env.extensions.extension_settings.preset_allowed_regex?.openai || [];
  if (preserveRegex && originalRegex.some(script=>script.disabled!==true) && allowed.includes(name)!==allowed.includes(snapshotContext(env).presetName)) throw new Error('两个预设的正则授权状态不同，无法保持正则不变；请先在酒馆统一授权状态后重试');
  // 只修改原生本次加载的副本，预设文件和预设库保持原样；原生随后正常绘制正则。
  const preserve=({preset,presetName})=>{
    if (presetName!==name || snapshotContext(env).scope!==scope) return;
    preset.extensions ??= {};preset.extensions.regex_scripts=clone(originalRegex);
    preset.extensions.baibaiToolkit ??= {};
    preset.extensions.baibaiToolkit.regexGroups={...(originalGroups ? clone(originalGroups) : {groups:[],scripts:{},ungrouped:{}}),version:1};
  };
  let listener, timer;
  try {
    if (preserveRegex) (events.makeFirst || events.on).call(events,beforeType,preserve);
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
    if (preserveRegex) (events.removeListener || events.off)?.call(events, beforeType, preserve);
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
  await env.openai.promptManager?.render?.(false);
  const type = env.script.event_types?.OAI_PRESET_CHANGED_AFTER;
  if (type) await env.script.eventSource?.emit?.(type);
}

async function applySettingsSnapshot(env, snapshot, payload, automatic = false) {
  const preserveRegex=snapshot.scope!==undefined && !snapshotScope(snapshot).regex;
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
  await selectSnapshotPreset(env, targetName, context.scope, preserveRegex);
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
  if (snapshot.groups.length && env.extensions.extension_settings.baiBaiToolkit?.presetGroupingEnabled === false) warnings.push('柏宝箱的预设分组功能已关闭，分组总开关暂不参与生成');
  if (missingWorldNames.length) warnings.push('未挂载缺失世界书：'+missingWorldNames.join('、'));
  return {warnings};
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
      return applySettingsSnapshot(env, existing, payload);
    }
    if (method === 'snapshot-save' || method === 'snapshot-save-draft') {
      assertSnapshotContext(env, payload.contextKey);
      if (payload.id && !existing) throw new Error('快照已删除，请重新保存');
      await waitSnapshotPreset(env, context);
      await settleBaiBai(env, context);
      assertSnapshotContext(env, payload.contextKey);
      assertSnapshotIdle(env);
      const included=snapshotScope({scope:method==='snapshot-save-draft' ? payload.draft?.scope : payload.scope,resources:{}});
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
      store.snapshots = store.snapshots.filter(s => s.id !== payload.id);
      for (const key of Object.keys(store.characterBindings)) if (store.characterBindings[key] === payload.id) delete store.characterBindings[key];
      try {await saveSnapshotSettings(env);} catch (error) {Object.assign(store, before); throw error;}
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
        const result = await applySettingsSnapshot(env, latest.snapshot, {contextKey: latestContext.key}, true);
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

  open() {
    this.openRequested = true;
    if (!this.dialog?.isConnected) this.mount();
    try {
      if (!this.dialog.open) this.dialog.showModal();
    } catch (error) {
      console.error(`[${APP_ID}] open host dialog failed`, error);
      this.dialog.setAttribute('open', '');
    }
    if (this.uiReady) this.sendEvent('open');
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
    this.iframe.src = new URL('./ui/index.html', import.meta.url).href;
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
      if (this.openRequested) this.sendEvent('open');
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

// 扩展更新 hook（ST 官方约定，manifest.hooks.update 指向本导出）：
// ST 在「扩展更新」成功后调用，扩展自行决定收尾。这里直接整页刷新，
// 让酒馆重新加载入口/宿主/iframe 全部脚本——比手动 F5 更可靠（无旧模块缓存），
// 也与 JS-Slash-Runner 的「更新成功后刷新页面以生效」同款行为。
export async function reloadAfterUpdate() {
  location.reload();
}
