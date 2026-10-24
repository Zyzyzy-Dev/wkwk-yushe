// 预设字面量查找替换：生成精确原文预览，并在完整字段基线校验后原子更新草稿。
const ALLOWED_FIELDS = new Set(['name', 'content']);
const matchKey = (id, field, start, end) => JSON.stringify([id, field, start, end]);
const fieldKey = (id, field) => JSON.stringify([id, field]);

function checkQuery(query) {
  if (typeof query !== 'string' || query.length === 0) throw new Error('查找内容不能为空。');
}

function checkFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0 || fields.some(field => !ALLOWED_FIELDS.has(field))) {
    throw new Error('替换字段只能选择名称或正文。');
  }
  return [...new Set(fields)];
}

function checkEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('预设条目列表无效。');
}

function indexEntries(entries) {
  const byId = new Map();
  for (const entry of entries) {
    const id = entry?.identifier;
    const list = byId.get(id) || [];
    list.push(entry);
    byId.set(id, list);
  }
  return byId;
}

function uniqueEntry(byId, id) {
  if (typeof id !== 'string' || id.length === 0 || byId.get(id)?.length !== 1) {
    throw new Error('替换目标的条目 ID 缺失、重复或已变化，请重新预览。');
  }
  return byId.get(id)[0];
}

/** Return non-overlapping offsets in the original UTF-16 string, preserving all whitespace. */
export function findLiteralRanges(text, query, {caseSensitive = true} = {}) {
  checkQuery(query);
  if (typeof text !== 'string') throw new Error('查找目标必须是文本。');
  if (typeof caseSensitive !== 'boolean') throw new Error('区分大小写选项无效。');
  const ranges = [];
  if (caseSensitive) {
    let from = 0, start;
    while ((start = text.indexOf(query, from)) !== -1) {
      const end = start + query.length;
      ranges.push([start, end]);
      from = end;
    }
    return ranges;
  }
  // Escape every metacharacter. Unicode simple case folding keeps offsets in the original
  // string; lowercasing first would shift offsets for characters such as Turkish dotted I.
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(literal, 'giu');
  for (const match of text.matchAll(expression)) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

/** Create an immutable-input preview. `before` is a hit; baselines contain whole fields. */
export function createReplacementPlan(entries, {query, replacement, caseSensitive = true, fields = ['content']} = {}) {
  checkEntries(entries);
  checkQuery(query);
  if (typeof replacement !== 'string') throw new Error('替换内容必须是文本。');
  if (typeof caseSensitive !== 'boolean') throw new Error('区分大小写选项无效。');
  fields = checkFields(fields);
  const byId = indexEntries(entries), matches = [], baselines = [], changedIds = new Set();
  for (const entry of entries) {
    for (const field of fields) {
      const text = entry?.[field];
      if (typeof text !== 'string') continue;
      const ranges = findLiteralRanges(text, query, {caseSensitive}).filter(([start, end]) => text.slice(start, end) !== replacement);
      if (!ranges.length) continue;
      const id = entry.identifier;
      uniqueEntry(byId, id);
      changedIds.add(id);
      baselines.push({id, field, text});
      for (const [start, end] of ranges) {
        matches.push({key: matchKey(id, field, start, end), id, field, start, end, before: text.slice(start, end), replacement});
      }
    }
  }
  return {version: 1, query, replacement, caseSensitive, fields, matches, baselines, entryCount: changedIds.size};
}

/** Validate every selected field before constructing any replacement; never mutate input. */
export function applyReplacementPlan(entries, plan, selectedKeys) {
  checkEntries(entries);
  if (!plan || plan.version !== 1 || !Array.isArray(plan.matches) || !Array.isArray(plan.baselines)) {
    throw new Error('替换预览无效，请重新查找。');
  }
  checkQuery(plan.query);
  const fields = new Set(checkFields(plan.fields));
  if (typeof plan.replacement !== 'string' || typeof plan.caseSensitive !== 'boolean') throw new Error('替换预览无效，请重新查找。');
  if (selectedKeys !== undefined && !Array.isArray(selectedKeys) && !(selectedKeys instanceof Set)) {
    throw new Error('替换选择无效，请重新选择。');
  }
  const allMatches = new Map();
  for (const match of plan.matches) {
    if (!match || typeof match.key !== 'string' || allMatches.has(match.key)) throw new Error('替换预览包含重复或无效命中，请重新查找。');
    allMatches.set(match.key, match);
  }
  const selected = selectedKeys === undefined ? new Set(allMatches.keys()) : new Set(selectedKeys);
  if (!selected.size) return {entries, changedIds: [], replacementCount: 0};
  const baselines = new Map();
  for (const baseline of plan.baselines) {
    if (!baseline || typeof baseline.text !== 'string' || !ALLOWED_FIELDS.has(baseline.field)) throw new Error('替换原文记录无效，请重新查找。');
    const key = fieldKey(baseline.id, baseline.field);
    if (baselines.has(key)) throw new Error('替换原文记录重复，请重新查找。');
    baselines.set(key, baseline);
  }
  const byId = indexEntries(entries), selectedFields = new Map();
  for (const key of selected) {
    const match = allMatches.get(key);
    if (!match) throw new Error('所选命中已不在替换预览中，请重新查找。');
    const {id, field, start, end, before, replacement} = match;
    if (!fields.has(field) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || key !== matchKey(id, field, start, end) || replacement !== plan.replacement) {
      throw new Error('所选命中的位置或字段无效，请重新查找。');
    }
    const entry = uniqueEntry(byId, id), target = fieldKey(id, field), baseline = baselines.get(target);
    if (!baseline || entry[field] !== baseline.text) throw new Error('替换目标的名称或正文已变化，请重新预览后再替换。');
    if (end > baseline.text.length || baseline.text.slice(start, end) !== before) throw new Error('所选命中与原文不一致，请重新查找。');
    let group = selectedFields.get(target);
    if (!group) {
      const validRanges = new Set(findLiteralRanges(baseline.text, plan.query, {caseSensitive: plan.caseSensitive}).map(([a, b]) => `${a}:${b}`));
      group = {id, field, text: baseline.text, ranges: validRanges, matches: []};
      selectedFields.set(target, group);
    }
    if (!group.ranges.has(`${start}:${end}`)) throw new Error('所选命中不符合查找内容，请重新查找。');
    group.matches.push(match);
  }
  // All selected baselines are validated above. Compose from original slices so replacement
  // strings (including $&, $1 and query text itself) are inserted literally and only once.
  const updates = new Map();
  let replacementCount = 0;
  for (const group of selectedFields.values()) {
    const parts = [];
    let cursor = 0;
    for (const match of group.matches.sort((a, b) => a.start - b.start)) {
      if (match.start < cursor) throw new Error('替换命中相互重叠，请重新查找。');
      parts.push(group.text.slice(cursor, match.start), match.replacement);
      cursor = match.end;
      if (match.before !== match.replacement) replacementCount++;
    }
    parts.push(group.text.slice(cursor));
    const value = parts.join('');
    if (value === group.text) continue;
    const entry = updates.get(group.id) || {...uniqueEntry(byId, group.id)};
    entry[group.field] = value;
    updates.set(group.id, entry);
  }
  if (!updates.size) return {entries, changedIds: [], replacementCount: 0};
  return {
    entries: entries.map(entry => updates.get(entry?.identifier) || entry),
    changedIds: entries.filter(entry => updates.has(entry?.identifier)).map(entry => entry.identifier),
    replacementCount,
  };
}
