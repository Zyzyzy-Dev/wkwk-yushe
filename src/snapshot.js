// 设置快照纯逻辑：捕获两层开关、按稳定 ID 制定恢复计划及解析聊天/角色绑定，不访问宿主。
import { createIdentifier, findPromptOrderEntry } from './core.js';
import { validateSnapshotResources } from './snapshot-resources.js';

export function snapshotScope(snapshot) {
  if (snapshot.scope === undefined) return {preset:true, worlds:true, regex:!!snapshot.resources};
  const scope = snapshot.scope;
  if (!scope || ['preset','worlds','regex'].some(key => typeof scope[key] !== 'boolean') || !['preset','worlds','regex'].some(key => scope[key])) throw new Error('请至少勾选一项有效的快照保存范围');
  return {preset:scope.preset, worlds:scope.worlds, regex:scope.regex};
}

// 未选范围从持久化副本中移除；编辑页仍保留本轮草稿，重新勾选不会丢失修改。
export function selectSnapshotScope(snapshot) {
  const scope = snapshotScope(snapshot), saved = {...snapshot, scope};
  if (!scope.preset) {saved.entries=[];saved.groups=[];}
  if (!scope.worlds) saved.worldNames=[];
  if (snapshot.resources) saved.resources = {...snapshot.resources,
    ...(!scope.worlds ? {worlds:{global:[]},worldEntries:[]} : {}),
    ...(!scope.regex ? {regex:{global:[],preset:[],character:[]}} : {}),
  };
  return saved;
}

export function normalizeSnapshotName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new Error('快照名称须为 1–120 个字符');
  return value.trim();
}

function names(value) {
  if (!Array.isArray(value) || value.some(name => typeof name !== 'string' || !name)) throw new Error('世界书挂载数据无效，请重新保存快照');
  return [...new Set(value)];
}

function uniqueRecords(value, key) {
  if (!Array.isArray(value)) throw new Error('快照开关数据无效');
  const ids = new Set();
  for (const item of value) {
    if (!item || typeof item[key] !== 'string' || !item[key] || ids.has(item[key]) || typeof item.enabled !== 'boolean') throw new Error('快照存在无效或重复的开关记录');
    ids.add(item[key]);
  }
  return value;
}

export function snapshotOrder(settings, characterId) {
  if (characterId === null || characterId === undefined || !['string', 'number'].includes(typeof characterId)) throw new Error('当前预设条目列表尚未就绪');
  const nodes = (settings?.prompt_order || []).filter(node => String(node?.character_id) === String(characterId));
  if (nodes.length !== 1 || !Array.isArray(nodes[0].order)) throw new Error('当前预设条目节点缺失或重复，无法安全恢复');
  return nodes[0].order;
}

export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id) throw new Error('快照数据无效，请重新保存');
  const scope = snapshotScope(snapshot);
  if (scope.preset && (typeof snapshot.presetName !== 'string' || !snapshot.presetName)) throw new Error('快照预设无效');
  normalizeSnapshotName(snapshot.name);
  if (scope.preset && !['string', 'number'].includes(typeof snapshot.orderCharacterId)) throw new Error('快照预设节点无效');
  uniqueRecords(snapshot.entries, 'identifier');
  uniqueRecords(snapshot.groups, 'id');
  names(snapshot.worldNames);
  if (snapshot.resources !== undefined) {
    validateSnapshotResources(snapshot.resources);
    if (JSON.stringify(snapshot.worldNames) !== JSON.stringify(snapshot.resources.worlds.global)) throw new Error('快照全局世界书记录不一致');
  }
  return snapshot;
}

export function captureSnapshot({ id = createIdentifier(), name, presetName, settings, orderCharacterId, groupState, worldNames, now = Date.now() }) {
  const labels = new Map((settings?.prompts || []).map(p => [p.identifier, String(p.name || p.identifier)]));
  const snapshot = {
    id, name: normalizeSnapshotName(name), presetName, orderCharacterId,
    createdAt: now, updatedAt: now,
    entries: snapshotOrder(settings, orderCharacterId).map(item => ({identifier: item?.identifier, name: labels.get(item?.identifier) || String(item?.identifier || ''), enabled: item?.enabled === true})),
    groups: (groupState?.groups || []).map(group => ({id: String(group.id || ''), name: String(group.name || group.id), enabled: group.enabled !== false})),
    worldNames: names(worldNames),
  };
  return validateSnapshot(snapshot);
}

// 编辑器辅助信息每次从当前预设读取，不属于快照备份，不参与应用或保存。
export function snapshotPresetEditor(snapshot, settings, groupState) {
  const prompts = new Map((settings?.prompts || []).map(item => [item.identifier, item]));
  const node = findPromptOrderEntry({prompts:settings?.prompts, prompt_order:settings?.prompt_order});
  const ids = [...new Set([...(node?.order || []).map(item => typeof item === 'string' ? item : item?.identifier), ...prompts.keys()])];
  const order = new Map(ids.map((id, index) => [id, index]));
  const groupIds = new Set((groupState?.groups || []).map(group => String(group.id)));
  const entries = snapshot.entries.map(item => {
    const prompt = prompts.get(item.identifier), groupId = String(groupState?.prompts?.[item.identifier]?.groupId||'');
    return {identifier:item.identifier, name:String(prompt?.name || item.name), content:String(prompt?.content || ''), groupId:groupIds.has(groupId) ? groupId : null, missing:!prompt, order:order.get(item.identifier) ?? ids.length};
  });
  const groups = snapshot.groups.map(group => ({id:group.id, name:group.name, memberIds:entries.filter(entry => entry.groupId === group.id).map(entry => entry.identifier)}));
  return {entries, groups};
}

// 与预设编辑器一样按当前顺序分段，不能按分组收拢条目；只返回草稿引用，不改变保存顺序。
export function snapshotPresetSections(items, groups, metadata) {
  const records = new Map(metadata.map(item => [item.identifier, item]));
  const knownGroups = new Set(groups.map(group => String(group.id)));
  const ordered = [...items].sort((a, b) => (records.get(a.identifier)?.order ?? Infinity) - (records.get(b.identifier)?.order ?? Infinity));
  const sections = [];
  for (const item of ordered) {
    const owner = records.get(item.identifier)?.groupId;
    const groupId = owner != null && knownGroups.has(String(owner)) ? String(owner) : null;
    if (!sections.length || sections.at(-1).groupId !== groupId) sections.push({groupId, entries:[]});
    sections.at(-1).entries.push(item);
  }
  const shown = new Set(sections.map(section => section.groupId));
  for (const group of groups) if (!shown.has(String(group.id))) sections.push({groupId:String(group.id), entries:[]});
  return sections;
}

export function planSnapshotRestore(snapshot, { settings, orderCharacterId, groupState, worldNames }) {
  snapshot = selectSnapshotScope(snapshot);
  validateSnapshot(snapshot);
  const scope = snapshotScope(snapshot);
  if (scope.preset && String(snapshot.orderCharacterId) !== String(orderCharacterId)) throw new Error('快照与当前预设的条目节点不同，请重新保存快照');
  const order = scope.preset ? snapshotOrder(settings, orderCharacterId) : [];
  const ids = new Set(order.map(entry => entry?.identifier));
  if (ids.size !== order.length) throw new Error('当前条目列表存在重复 ID，无法安全恢复');
  const groupIds = new Set((groupState?.groups || []).map(group => String(group.id)));
  const availableBooks = new Set(scope.worlds ? names(worldNames) : []);
  return {
    entries: snapshot.entries.filter(entry => ids.has(entry.identifier)).map(({identifier, enabled}) => ({identifier, enabled})),
    groups: snapshot.groups.filter(group => groupIds.has(group.id)).map(({id, enabled}) => ({id, enabled})),
    worldNames: snapshot.worldNames.filter(name => availableBooks.has(name)),
    missingEntries: snapshot.entries.filter(entry => !ids.has(entry.identifier)).map(entry => entry.name || entry.identifier),
    missingGroups: snapshot.groups.filter(group => !groupIds.has(group.id)).map(group => group.name || group.id),
    missingWorldNames: snapshot.worldNames.filter(name => !availableBooks.has(name)),
  };
}

export function resolveSnapshotBinding(store, chatSnapshotId, characterKey) {
  const snapshots = Array.isArray(store?.snapshots) ? store.snapshots : [];
  const chat = snapshots.find(s => s.id === chatSnapshotId);
  if (chat) return {snapshot: chat, source: 'chat'};
  const id = characterKey && Object.hasOwn(store?.characterBindings || {}, characterKey) ? store.characterBindings[characterKey] : null;
  const character = id && snapshots.find(s => s.id === id);
  return character ? {snapshot: character, source: 'character'} : null;
}
