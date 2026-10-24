// 查找替换条目视图：保持完整候选、分组成员与预设顺序，复用纯替换核心生成不可变预览。
import {applyReplacementPlan, createReplacementPlan, findLiteralRanges} from '../text-replace.js';

/** Candidate visibility depends only on search conditions, never replacement selection. */
export function buildReplacementView(context, {query = '', fields = ['content'], caseSensitive = true} = {}) {
  const source = Array.isArray(context?.entries) ? context.entries : [];
  const counts = new Map();
  for (const entry of source) counts.set(entry?.identifier, (counts.get(entry?.identifier) || 0) + 1);
  const order = new Map();
  for (const id of context?.orderedIds || []) if (!order.has(id)) order.set(id, order.size);
  const entries = source.map((entry, index) => {
    const id = typeof entry?.identifier === 'string' ? entry.identifier : '';
    return {entry, id, key: String(index), selectable: !!id && counts.get(id) === 1, index};
  }).sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.index - b.index);
  const candidates = entries.filter(({entry}) => !query || fields.some(field =>
    typeof entry?.[field] === 'string' && findLiteralRanges(entry[field], query, {caseSensitive}).length > 0));
  const byId = new Map(entries.filter(item => item.selectable).map(item => [item.id, item]));
  const assigned = new Set(), groups = [];
  for (const [index, group] of (context?.groups || []).entries()) {
    const groupIds = [...new Set(group.ids || [])].filter(id => byId.has(id) && !assigned.has(id));
    for (const id of groupIds) assigned.add(id);
    groups.push({id: String(group.id ?? index), name: group.name || '未命名分组', ids: groupIds, entries: entries.filter(item => groupIds.includes(item.id))});
  }
  const remaining = entries.filter(item => !item.selectable || !assigned.has(item.id));
  if (remaining.length) groups.push({id: '__ungrouped__', name: '未分组', ids: remaining.filter(item => item.selectable).map(item => item.id), entries: remaining});
  const position = new Map(entries.map((item, index) => [item.key, index]));
  groups.sort((a, b) => (position.get(a.entries[0]?.key) ?? Infinity) - (position.get(b.entries[0]?.key) ?? Infinity));
  return {entries, candidates, groups, invalidCount: entries.filter(item => !item.selectable).length};
}

/** Compose complete after-text with the same validated engine used by final application. */
export function createEntryReplacementPreview(entries, options) {
  const plan = createReplacementPlan(entries, options);
  const result = applyReplacementPlan(entries, plan);
  const changed = new Set(result.changedIds);
  for (const item of plan.matches) Object.freeze(item);
  for (const item of plan.baselines) Object.freeze(item);
  Object.freeze(plan.matches);
  Object.freeze(plan.baselines);
  Object.freeze(plan.fields);
  Object.freeze(plan);
  return {plan, afterById: new Map(result.entries.filter(entry => changed.has(entry.identifier)).map(entry => [entry.identifier, entry]))};
}

function segmentsFrom(text, ranges) {
  const segments = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({text: text.slice(cursor, start), hit: false});
    if (end > start) segments.push({text: text.slice(start, end), hit: true});
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length || !segments.length) segments.push({text: text.slice(cursor), hit: false});
  return segments;
}

/** Before/after segments for the preview window; offsets come from the validated plan only. */
export function buildReplacementComparison(plan, afterById, order = []) {
  const position = new Map(order.map((id, index) => [id, index]));
  const byField = new Map();
  for (const match of plan?.matches || []) {
    const key = match.id + '\u0000' + match.field;
    if (!byField.has(key)) byField.set(key, {id: match.id, field: match.field, matches: []});
    byField.get(key).matches.push(match);
  }
  const baselines = new Map((plan?.baselines || []).map(item => [item.id + '\u0000' + item.field, item.text]));
  const entries = new Map();
  for (const [key, group] of byField) {
    const before = baselines.get(key);
    if (typeof before !== 'string') continue;
    const sorted = [...group.matches].sort((a, b) => a.start - b.start);
    const afterRanges = [];
    let shift = 0;
    for (const match of sorted) {
      const start = match.start + shift;
      afterRanges.push([start, start + match.replacement.length]);
      shift += match.replacement.length - (match.end - match.start);
    }
    const afterEntry = afterById?.get(group.id);
    const after = typeof afterEntry?.[group.field] === 'string' ? afterEntry[group.field] : '';
    if (!entries.has(group.id)) entries.set(group.id, {id: group.id, name: '', count: 0, fields: []});
    const entry = entries.get(group.id);
    entry.count += sorted.length;
    entry.fields.push({field: group.field, before: segmentsFrom(before, sorted.map(m => [m.start, m.end])), after: segmentsFrom(after, afterRanges)});
  }
  for (const entry of entries.values()) {
    const nameBaseline = baselines.get(entry.id + '\u0000name');
    entry.name = afterById?.get(entry.id)?.name ?? nameBaseline ?? '';
    entry.originalName = nameBaseline;
    entry.fields.sort((a, b) => (a.field === 'name' ? 0 : 1) - (b.field === 'name' ? 0 : 1));
  }
  return [...entries.values()].sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity));
}
