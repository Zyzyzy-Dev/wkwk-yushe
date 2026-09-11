// 世界书工作台纯数据逻辑：安全规范化、跨书配对、隔离迁移排序及预设条目转换。
import { findPromptOrderEntry, validatePreset } from './core.js';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const defaults = () => ({
  key: [], keysecondary: [], comment: '', content: '', constant: true, vectorized: false,
  selective: true, selectiveLogic: 0, addMemo: false, order: 100, position: 0, disable: false,
  ignoreBudget: false, excludeRecursion: false, preventRecursion: false,
  matchPersonaDescription: false, matchCharacterDescription: false, matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false, matchScenario: false, matchCreatorNotes: false,
  delayUntilRecursion: 0, probability: 100, useProbability: true, depth: 4,
  outletName: '', group: '', groupOverride: false, groupWeight: 100, scanDepth: null,
  caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '', role: 0,
  sticky: null, cooldown: null, delay: null, triggers: [],
});

// JSON 校验先于克隆/展开；拒绝访问器、非有限数、循环、特殊原型和危险键。
function jsonCopy(value, stack = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || stack.has(value)) throw new Error('数据必须是有效 JSON，不能含循环或非 JSON 值。');
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (!array && proto !== Object.prototype && proto !== null) throw new Error('数据必须是普通 JSON 对象。');
  stack.add(value);
  const result = array ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string' || forbidden.has(key)) throw new Error('JSON 含不安全字段。');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !own(descriptor, 'value')) throw new Error('JSON 含无效字段。');
    if (array && !/^(0|[1-9]\d*)$/.test(key)) throw new Error('JSON 数组含无效字段。');
    result[key] = jsonCopy(descriptor.value, stack);
  }
  if (array && Object.keys(result).length !== value.length) throw new Error('JSON 数组不能含空槽。');
  stack.delete(value);
  return result;
}

function uid(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error('世界书 UID 必须是非负安全整数。');
  }
  return Number(value);
}

function validateEntry(entry) {
  if (!object(entry) || typeof entry.content !== 'string') throw new Error('世界书条目缺少有效正文 content。');
  for (const key of ['comment', 'name', 'outletName', 'group', 'automationId']) {
    if (own(entry, key) && typeof entry[key] !== 'string') throw new Error(`世界书 ${key} 必须是文本。`);
  }
  for (const key of ['key', 'keysecondary', 'keys', 'secondary_keys', 'triggers']) {
    if (own(entry, key) && (!Array.isArray(entry[key]) || entry[key].some(item => typeof item !== 'string'))) throw new Error(`世界书 ${key} 必须是字符串数组。`);
  }
  const base = defaults();
  for (const key of [...Object.keys(base).filter(key => typeof base[key] === 'boolean'), 'enabled', 'disabled', 'characterFilterExclude']) {
    if (own(entry, key) && typeof entry[key] !== 'boolean') throw new Error(`世界书 ${key} 必须是开关值。`);
  }
  for (const key of ['caseSensitive', 'matchWholeWords', 'useGroupScoring']) {
    if (own(entry, key) && entry[key] !== null && typeof entry[key] !== 'boolean') throw new Error(`世界书 ${key} 必须是开关值或 null。`);
  }
  for (const key of ['position', 'depth', 'order', 'displayIndex', 'probability', 'selectiveLogic', 'groupWeight']) {
    if (own(entry, key) && (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]))) throw new Error(`世界书 ${key} 必须是有限数字。`);
  }
  for (const key of ['scanDepth', 'sticky', 'cooldown', 'delay']) {
    if (own(entry, key) && entry[key] !== null && (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]))) throw new Error(`世界书 ${key} 必须是数字或 null。`);
  }
  // 旧酒馆把 delayUntilRecursion 存成布尔值；读取时保留其语义。
  if (own(entry, 'delayUntilRecursion') && typeof entry.delayUntilRecursion !== 'boolean' && (typeof entry.delayUntilRecursion !== 'number' || !Number.isFinite(entry.delayUntilRecursion))) throw new Error('递归延迟值无效。');
  if (own(entry, 'probability') && (entry.probability < 0 || entry.probability > 100)) throw new Error('概率必须为 0 到 100。');
  if (own(entry, 'role') && entry.role !== null && ![0, 1, 2].includes(entry.role)) throw new Error('角色必须为 0、1、2 或 null。');
}

const extensionKeys = {
  exclude_recursion: 'excludeRecursion', prevent_recursion: 'preventRecursion', delay_until_recursion: 'delayUntilRecursion',
  display_index: 'displayIndex', outlet_name: 'outletName', group_override: 'groupOverride', group_weight: 'groupWeight',
  scan_depth: 'scanDepth', case_sensitive: 'caseSensitive', match_whole_words: 'matchWholeWords', use_group_scoring: 'useGroupScoring',
  automation_id: 'automationId', ignore_budget: 'ignoreBudget', match_persona_description: 'matchPersonaDescription',
  match_character_description: 'matchCharacterDescription', match_character_personality: 'matchCharacterPersonality',
  match_character_depth_prompt: 'matchCharacterDepthPrompt', match_scenario: 'matchScenario', match_creator_notes: 'matchCreatorNotes',
};

function standardEntry(entry) {
  const ext = entry.extensions ?? {};
  if (!object(ext)) throw new Error('世界书 extensions 必须是对象。');
  if (own(entry, 'position') && typeof entry.position !== 'number' && !['before_char', 'after_char'].includes(entry.position)) throw new Error('世界书 position 无效。');
  const result = { ...defaults(), ...entry, comment: entry.comment ?? entry.name ?? '', key: entry.keys ?? [],
    keysecondary: entry.secondary_keys ?? [], disable: entry.enabled === false, constant: entry.constant ?? false,
    selective: entry.selective ?? false, order: entry.insertion_order ?? 100,
    position: typeof entry.position === 'number' ? entry.position : entry.position === 'after_char' ? 1 : 0,
  };
  for (const [key, value] of Object.entries(ext)) {
    const target = extensionKeys[key] ?? key;
    if (own(defaults(), target) || target === 'displayIndex') result[target] = value;
  }
  return result;
}

export function normalizeWorkbenchBook(data) {
  const input = jsonCopy(data);
  const source = input?.entries ? input : input?.character_book ?? input?.data?.character_book;
  if (!object(source) || !own(source, 'entries') || (!object(source.entries) && !Array.isArray(source.entries))) throw new Error('不是有效世界书：缺少 entries。');
  const standard = Array.isArray(source.entries), rows = Object.entries(source.entries), occupied = new Set();
  const resolved = rows.map(([key, entry]) => {
    if (!object(entry)) throw new Error('世界书条目必须为对象。');
    const candidate = own(entry, 'uid') ? entry.uid : standard && own(entry, 'id') ? entry.id : !standard && /^(0|[1-9]\d*)$/.test(key) ? key : null;
    if (candidate === null && !own(entry, 'uid') && !(standard && own(entry, 'id'))) return null;
    const id = uid(candidate);
    if (occupied.has(id)) throw new Error(`世界书 UID 重复：${id}`);
    occupied.add(id); return id;
  });
  const result = { ...source, entries: {} };
  let next = 0;
  rows.forEach(([, original], index) => {
    let id = resolved[index];
    if (id === null) { while (occupied.has(next)) next++; id = next++; occupied.add(id); }
    const entry = standard ? standardEntry(original) : original;
    if (['system', 'user', 'assistant'].includes(entry.role)) entry.role = ['system', 'user', 'assistant'].indexOf(entry.role);
    validateEntry(entry);
    entry.uid = id;
    if (!own(entry, 'displayIndex')) entry.displayIndex = index;
    result.entries[id] = entry;
  });
  return result;
}

export function workbenchEntries(book) {
  return Object.entries(book.entries).map(([id, entry], index) => ({ id, entry, index }))
    .sort((a, b) => (Number.isFinite(a.entry.displayIndex) ? a.entry.displayIndex : a.index) - (Number.isFinite(b.entry.displayIndex) ? b.entry.displayIndex : b.index) || a.index - b.index)
    .map(({ id, entry }) => ({ id, entry }));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function compareWorldbooks(left, right, { ignoreWhitespace = false } = {}) {
  const a = workbenchEntries(normalizeWorkbenchBook(left)), b = workbenchEntries(normalizeWorkbenchBook(right));
  const paired = new Map(), used = new Set(), body = entry => ignoreWhitespace ? entry.content.replace(/\s+/g, '') : entry.content;
  for (const keyOf of [entry => (entry.comment || entry.name || '').trim(), body]) {
    const groups = rows => {
      const map = new Map();
      for (const row of rows) { const key = keyOf(row.entry); if (key) map.set(key, [...(map.get(key) || []), row]); }
      return map;
    };
    const la = groups(a.filter(row => !paired.has(row.id))), rb = groups(b.filter(row => !used.has(row.id)));
    for (const [key, rows] of la) if (rows.length === 1 && rb.get(key)?.length === 1) {
      paired.set(rows[0].id, rb.get(key)[0]); used.add(rb.get(key)[0].id);
    }
  }
  const settings = entry => JSON.stringify(canonical(Object.fromEntries(Object.entries(entry).filter(([key]) => !['uid', 'displayIndex', 'content'].includes(key)))));
  return [...a.map(row => {
    const match = paired.get(row.id);
    return { leftId: row.id, rightId: match?.id ?? null, status: !match ? 'only' : body(row.entry) !== body(match.entry) ? 'content' : settings(row.entry) !== settings(match.entry) ? 'settings' : 'same' };
  }), ...b.filter(row => !used.has(row.id)).map(row => ({ leftId: null, rightId: row.id, status: 'only' }))];
}

function selected(book, ids) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('请先选择条目。');
  const list = ids.map(String);
  if (new Set(list).size !== list.length || list.some(id => !own(book.entries, id))) throw new Error('所选条目已失效或重复。');
  return list;
}

function insertionIndex(ids, { beforeId = null, afterId = null, placement = 'end' } = {}) {
  if (beforeId !== null && afterId !== null) throw new Error('不能同时指定前后位置。');
  const anchor = beforeId ?? afterId;
  if (anchor !== null) {
    const index = ids.indexOf(String(anchor));
    if (index < 0) throw new Error('插入位置已失效或指向移动条目自身。');
    return index + Number(afterId !== null);
  }
  if (!['start', 'end'].includes(placement)) throw new Error('插入位置无效。');
  return placement === 'start' ? 0 : ids.length;
}

function insertEntries(book, entries, options) {
  const order = workbenchEntries(book).map(row => row.id), at = insertionIndex(order, options), ids = [];
  let next = 0;
  for (const entry of entries) {
    while (own(book.entries, String(next))) next++;
    if (!Number.isSafeInteger(next)) throw new Error('没有可分配的世界书 UID。');
    const id = String(next++); ids.push(id); book.entries[id] = { ...entry, uid: Number(id) };
  }
  order.splice(at, 0, ...ids);
  order.forEach((id, index) => { book.entries[id].displayIndex = index; });
  return { book, ids };
}

export function transferWorldEntries(source, target, ids, { mode = 'copy', targetId = null, ...options } = {}) {
  const from = normalizeWorkbenchBook(source), book = normalizeWorkbenchBook(target), chosen = selected(from, ids);
  if (mode === 'replace') {
    if (chosen.length !== 1 || targetId === null || !own(book.entries, String(targetId))) throw new Error('替换必须指定一个来源和有效目标条目。');
    const id = String(targetId), previous = book.entries[id];
    book.entries[id] = { ...from.entries[chosen[0]], uid: previous.uid, displayIndex: previous.displayIndex };
    return { book, ids: [id] };
  }
  if (mode !== 'copy') throw new Error('迁移模式无效。');
  return insertEntries(book, chosen.map(id => from.entries[id]), options);
}

export function reorderWorldEntries(source, ids, options = {}) {
  const book = normalizeWorkbenchBook(source), chosen = selected(book, ids), set = new Set(chosen);
  const order = workbenchEntries(book).map(row => row.id), moving = order.filter(id => set.has(id)), rest = order.filter(id => !set.has(id));
  rest.splice(insertionIndex(rest, options), 0, ...moving);
  rest.forEach((id, index) => { book.entries[id].displayIndex = index; });
  return { book, ids: moving };
}

export function presetWorkbenchEntries(preset) {
  const source = jsonCopy(preset); validatePreset(source);
  const prompts = new Map(source.prompts.map(prompt => [prompt.identifier, prompt])), node = findPromptOrderEntry(source);
  const enabled = new Map((node?.order || []).map(item => [typeof item === 'string' ? item : item.identifier, typeof item === 'string' || item.enabled !== false]));
  const ids = [...new Set([...enabled.keys(), ...prompts.keys()])];
  return ids.filter(id => prompts.has(id) && !prompts.get(id).marker).map(id => {
    const prompt = prompts.get(id);
    if (typeof prompt.content !== 'string') throw new Error(`预设条目 ${id} 正文无效。`);
    // 单条开关取当前 prompt_order；分组总门控独立，转换不把组关闭永久写入条目。
    return { id, name: prompt.name || id, content: prompt.content, enabled: enabled.get(id) === true,
      role: prompt.role ?? 'system', depth: prompt.injection_depth ?? 4, order: prompt.injection_order ?? 100,
      injectionPosition: prompt.injection_position ?? 0 };
  });
}

export function insertPresetWorldEntries(source, entries, { trigger = 'constant', ...options } = {}) {
  const book = normalizeWorkbenchBook(source), input = jsonCopy(entries);
  if (!Array.isArray(input) || !input.length) throw new Error('请先选择预设条目。');
  if (!['constant', 'keyword', 'vectorized'].includes(trigger)) throw new Error('世界书触发方式无效。');
  const converted = input.map(entry => {
    if (!object(entry) || typeof entry.content !== 'string') throw new Error('预设条目正文无效。');
    const role = ['system', 'user', 'assistant'].includes(entry.role) ? ['system', 'user', 'assistant'].indexOf(entry.role) : entry.role ?? 0;
    const result = { ...defaults(), comment: entry.name ?? '', content: entry.content, disable: entry.enabled === false,
      constant: trigger === 'constant', vectorized: trigger === 'vectorized', role,
      depth: entry.depth ?? 4, order: entry.order ?? 100, position: entry.injectionPosition === 1 ? 4 : 0 };
    validateEntry(result); return result;
  });
  return insertEntries(book, converted, options);
}

export function createWorkbenchEntry(source, options = {}) {
  return insertEntries(normalizeWorkbenchBook(source), [defaults()], options);
}
