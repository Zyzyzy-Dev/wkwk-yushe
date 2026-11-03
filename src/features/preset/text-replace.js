// 预设文本与正则查找替换：生成精确预览，并在完整字段与命中校验后原子更新草稿。
const ALLOWED_FIELDS = new Set(['name', 'content']);
export const MAX_SEARCH_MATCHES = 100000;
// Prefix/suffix substitutions can grow quadratically even with few matches.
const MAX_REGEX_OUTPUT_LENGTH = 20000000;
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

function countMatch(budget) {
  if (++budget.count > MAX_SEARCH_MATCHES) throw new Error('查找命中过多，已超过单次处理上限，请缩小查找范围。');
}

function createMatcher(query, {caseSensitive = true, regex = false} = {}) {
  checkQuery(query);
  if (typeof caseSensitive !== 'boolean') throw new Error('区分大小写选项无效。');
  if (typeof regex !== 'boolean') throw new Error('正则表达式选项无效。');
  if (!regex) {
    if (caseSensitive) return {literal: query};
    // Unicode folding preserves original offsets; lowercasing would shift dotted-I offsets.
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {expression: new RegExp(literal, 'giu')};
  }
  let source = query, flags = '';
  if (query.startsWith('/')) {
    let escaped = false, inClass = false, closing = -1;
    for (let index = 1; index < query.length; index++) {
      const char = query[index];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) closing = index;
    }
    if (closing !== -1) {
      source = query.slice(1, closing);
      flags = query.slice(closing + 1);
    }
  }
  if (!source) throw new Error('正则表达式不能为空。');
  try {
    // First validate the supplied flags unchanged; adding g must not hide duplicate flags.
    const expression = new RegExp(source, flags);
    return {expression: new RegExp(expression.source, flags.includes('g') ? flags : flags + 'g')};
  } catch (error) {
    throw new Error('正则表达式无效：' + error.message);
  }
}

function advanceIndex(text, index, unicode) {
  if (!unicode || index + 1 >= text.length) return index + 1;
  const first = text.charCodeAt(index), second = text.charCodeAt(index + 1);
  return first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1;
}

function *iterateMatches(text, matcher, budget) {
  if (typeof text !== 'string') throw new Error('查找目标必须是文本。');
  if (matcher.literal !== undefined) {
    let from = 0, start;
    while ((start = text.indexOf(matcher.literal, from)) !== -1) {
      countMatch(budget);
      const match = [matcher.literal];
      match.index = start;
      yield match;
      from = start + matcher.literal.length;
    }
    return;
  }
  const expression = matcher.expression;
  expression.lastIndex = 0;
  let match;
  while ((match = expression.exec(text)) !== null) {
    countMatch(budget);
    yield match;
    // RegExp.exec leaves lastIndex unchanged for zero-width matches.
    if (!match[0].length) expression.lastIndex = advanceIndex(text, expression.lastIndex, expression.unicode || expression.unicodeSets);
  }
}

function accountOutput(budget, length) {
  budget.length += length;
  if (budget.length > MAX_REGEX_OUTPUT_LENGTH) throw new Error('替换结果过大，请缩小查找范围或减少替换内容。');
}

function expandReplacement(replacement, match, text, budget) {
  let result = '', cursor = 0;
  const append = value => { accountOutput(budget, value.length); result += value; };
  while (cursor < replacement.length) {
    const dollar = replacement.indexOf('$', cursor);
    if (dollar === -1) { append(replacement.slice(cursor)); break; }
    append(replacement.slice(cursor, dollar));
    const token = replacement[dollar + 1];
    let substitution, length = 2;
    if (token === '$') substitution = '$';
    else if (token === '&') substitution = match[0];
    else if (token === '`') substitution = text.slice(0, match.index);
    else if (token === "'") substitution = text.slice(match.index + match[0].length);
    else if (token === '<' && match.groups !== undefined) {
      const closing = replacement.indexOf('>', dollar + 2);
      if (closing !== -1) {
        substitution = match.groups[replacement.slice(dollar + 2, closing)] ?? '';
        length = closing - dollar + 1;
      }
    } else if (token >= '0' && token <= '9') {
      const second = replacement[dollar + 2];
      const hasSecond = second >= '0' && second <= '9';
      const firstIndex = Number(token), bothIndex = hasSecond ? firstIndex * 10 + Number(second) : 0;
      if (hasSecond && bothIndex > 0 && bothIndex < match.length) {
        substitution = match[bothIndex] ?? '';
        length = 3;
      } else if (firstIndex > 0 && firstIndex < match.length) substitution = match[firstIndex] ?? '';
    }
    if (substitution === undefined) { append('$'); cursor = dollar + 1; }
    else { append(substitution); cursor = dollar + length; }
  }
  return result;
}

/** Original UTF-16 offsets; regex execution belongs in a cancellable worker in the UI. */
export function findSearchRanges(text, query, options = {}) {
  const matcher = createMatcher(query, options);
  return Array.from(iterateMatches(text, matcher, {count: 0}), match => [match.index, match.index + match[0].length]);
}

/** Literal compatibility API: all punctuation and replacement-like tokens stay literal. */
export function findLiteralRanges(text, query, {caseSensitive = true} = {}) {
  return findSearchRanges(text, query, {caseSensitive, regex: false});
}

/** Create an immutable-input preview. `before` is a hit; baselines contain whole fields. */
export function createReplacementPlan(entries, {query, replacement, caseSensitive = true, regex = false, fields = ['content']} = {}) {
  checkEntries(entries);
  const matcher = createMatcher(query, {caseSensitive, regex});
  if (typeof replacement !== 'string') throw new Error('替换内容必须是文本。');
  fields = checkFields(fields);
  const byId = indexEntries(entries), matches = [], baselines = [], changedIds = new Set(), budget = {count: 0, length: 0};
  for (const entry of entries) {
    for (const field of fields) {
      const text = entry?.[field];
      if (typeof text !== 'string') continue;
      const hits = [];
      for (const hit of iterateMatches(text, matcher, budget)) {
        const resolved = regex ? expandReplacement(replacement, hit, text, budget) : replacement;
        if (hit[0] !== resolved) hits.push({start: hit.index, end: hit.index + hit[0].length, before: hit[0], replacement: resolved});
      }
      if (!hits.length) continue;
      const id = entry.identifier;
      uniqueEntry(byId, id);
      changedIds.add(id);
      baselines.push({id, field, text});
      for (const hit of hits) {
        matches.push({key: matchKey(id, field, hit.start, hit.end), id, field, ...hit});
      }
    }
  }
  return {version: 1, query, replacement, caseSensitive, regex, fields, matches, baselines, entryCount: changedIds.size};
}

/** Validate every selected field before constructing any replacement; never mutate input. */
export function applyReplacementPlan(entries, plan, selectedKeys) {
  checkEntries(entries);
  if (!plan || plan.version !== 1 || !Array.isArray(plan.matches) || !Array.isArray(plan.baselines)) {
    throw new Error('替换预览无效，请重新查找。');
  }
  const regex = plan.regex === undefined ? false : plan.regex;
  const matcher = createMatcher(plan.query, {caseSensitive: plan.caseSensitive, regex});
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
  const byId = indexEntries(entries), selectedFields = new Map(), budget = {count: 0, length: 0};
  for (const key of selected) {
    const match = allMatches.get(key);
    if (!match) throw new Error('所选命中已不在替换预览中，请重新查找。');
    const {id, field, start, end, before, replacement} = match;
    if (!fields.has(field) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || (!regex && end === start) || key !== matchKey(id, field, start, end) || typeof replacement !== 'string') {
      throw new Error('所选命中的位置或字段无效，请重新查找。');
    }
    const entry = uniqueEntry(byId, id), target = fieldKey(id, field), baseline = baselines.get(target);
    if (!baseline || entry[field] !== baseline.text) throw new Error('替换目标的名称或正文已变化，请重新预览后再替换。');
    if (end > baseline.text.length || baseline.text.slice(start, end) !== before) throw new Error('所选命中与原文不一致，请重新查找。');
    let group = selectedFields.get(target);
    if (!group) {
      const validRanges = new Map();
      for (const hit of iterateMatches(baseline.text, matcher, budget)) {
        const resolved = regex ? expandReplacement(plan.replacement, hit, baseline.text, budget) : plan.replacement;
        validRanges.set(`${hit.index}:${hit.index + hit[0].length}`, resolved);
      }
      group = {id, field, text: baseline.text, ranges: validRanges, matches: []};
      selectedFields.set(target, group);
    }
    if (!group.ranges.has(`${start}:${end}`)) throw new Error('所选命中不符合查找内容，请重新查找。');
    if (group.ranges.get(`${start}:${end}`) !== replacement) throw new Error('所选命中的替换内容无效，请重新查找。');
    group.matches.push(match);
  }
  // Compose from original slices after validation. Resolved substitutions are inserted once,
  // so inserted query text or dollar sequences never become another replacement operation.
  const updates = new Map();
  let replacementCount = 0;
  const outputBudget = {length: 0};
  for (const group of selectedFields.values()) {
    const parts = [];
    let cursor = 0;
    for (const match of group.matches.sort((a, b) => a.start - b.start)) {
      if (match.start < cursor) throw new Error('替换命中相互重叠，请重新查找。');
      if (regex) accountOutput(outputBudget, match.start - cursor + match.replacement.length);
      parts.push(group.text.slice(cursor, match.start), match.replacement);
      cursor = match.end;
      if (match.before !== match.replacement) replacementCount++;
    }
    if (regex) accountOutput(outputBudget, group.text.length - cursor);
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
