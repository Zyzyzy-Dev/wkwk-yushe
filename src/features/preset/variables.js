// 预设变量宏：保留原文位置的解析、批量添加/重命名/补写计划与原子草稿校验；不执行宏。
export const VARIABLE_KINDS = ['setvar', 'addvar', 'getvar', 'setglobalvar', 'addglobalvar', 'getglobalvar'];
export const variableKey = macro => JSON.stringify([macro.scope, macro.name.trim()]);

export function scanVariables(text) {
  text = String(text ?? '');
  const stack = [], spans = [];
  for (let i = 0; i < text.length - 1; i++) {
    const token = text.slice(i, i + 2);
    if (token === '{{') { stack.push(i); i++; }
    else if (token === '}}' && stack.length) { spans.push([stack.pop(), i + 2]); i++; }
  }
  return spans.sort((a, b) => a[0] - b[0]).flatMap(([start, end]) => {
    const raw = text.slice(start, end);
    const match = /^\{\{(setvar|addvar|getvar|setglobalvar|addglobalvar|getglobalvar)::([^:{}\r\n]+)(::([\s\S]*))?\}\}$/i.exec(raw);
    if (!match || !match[2].trim()) return [];
    const kind = match[1].toLowerCase(), read = kind.startsWith('get');
    if (read ? match[3] !== undefined : match[3] === undefined) return [];
    const nameStart = start + 2 + match[1].length + 2;
    return [{start, end, raw, kind, name:match[2].trim(), nameStart, nameEnd:nameStart + match[2].length,
      value:read ? '' : match[4], scope:kind.includes('global') ? 'global' : 'local'}];
  });
}

export function variableName(name) {
  name = String(name ?? '').trim();
  if (!name || /[:{}\r\n]/.test(name)) throw new Error('请输入变量名，不能包含冒号、花括号或换行');
  return name;
}

export function makeVariable(kind, name, value = ' ') {
  if (!VARIABLE_KINDS.includes(kind)) throw new Error('请选择有效的宏类型');
  name = variableName(name);
  if (kind.startsWith('get')) return '{{' + kind + '::' + name + '}}';
  value = String(value);
  // Reject broken delimiters, but preserve balanced nested macros and all original whitespace.
  let depth = 0;
  for (let i = 0; i < value.length - 1; i++) {
    const token = value.slice(i, i + 2);
    if (token === '{{') { depth++; i++; }
    else if (token === '}}') { if (!depth--) throw new Error('变量内容中存在未配对的 }}，请先修正'); i++; }
  }
  if (depth) throw new Error('变量内容中存在未配对的 {{，请先修正');
  // Older Tavern addvar requires a value; blank scaffolds use a single space.
  if (kind.startsWith('add') && value === '') value = ' ';
  const macro = '{{' + kind + '::' + name + '::' + value + '}}';
  const parsed = scanVariables(macro)[0];
  if (!parsed || parsed.raw !== macro || parsed.value !== value) throw new Error('内容末尾的花括号会与宏边界混淆，请调整后再预览');
  return macro;
}

function entry(prompts, id) {
  const found = prompts.filter(p => p.identifier === id);
  if (found.length !== 1 || found[0].marker) throw new Error('条目已失效、ID 重复或是系统占位条目，请重新选择');
  return found[0];
}
const content = prompt => String(prompt.content ?? '');
function change(prompt, after) { return {id:prompt.identifier, name:prompt.name || '(未命名)', before:content(prompt), after}; }
export function appendVariableText(before, macro) {
  const newline = before.includes('\r\n') ? '\r\n' : '\n';
  return before + (before && !before.endsWith('\n') ? newline : '') + macro;
}

export function planVariableAdd(prompts, ids, {kind, name, value = ' ', mode = 'append'}) {
  if (!ids.length) throw new Error('请至少选择一个条目');
  if (!['append', 'wrap'].includes(mode)) throw new Error('请选择添加方式');
  if (mode === 'wrap' && kind.startsWith('get')) throw new Error('getvar 只能读取变量，不能存放整段正文');
  const macro = makeVariable(kind, name, value);
  return [...new Set(ids)].map(id => {
    const prompt = entry(prompts, id), before = content(prompt);
    if (mode === 'wrap') return change(prompt, makeVariable(kind, name, before));
    // Exact existing macro is skipped; other values of the same variable remain independent.
    if (scanVariables(before).some(item => item.raw === macro)) return change(prompt, before);
    return change(prompt, appendVariableText(before, macro));
  }).filter(item => item.before !== item.after);
}

export function planVariableEdit(prompts, id, occurrence, fields) {
  const prompt = entry(prompts, id), before = content(prompt);
  const found = scanVariables(before).find(item => item.start === occurrence.start && item.end === occurrence.end && item.raw === occurrence.raw);
  if (!found) throw new Error('该变量位置已变化，请刷新后重新编辑');
  const after = before.slice(0, found.start) + makeVariable(fields.kind, fields.name, fields.value) + before.slice(found.end);
  return before === after ? [] : [change(prompt, after)];
}

export function planVariableRename(prompts, scope, oldName, newName) {
  newName = variableName(newName);
  if (newName === oldName) return [];
  const changes = [];
  for (const prompt of prompts.filter(p => !p.marker)) {
    const before = content(prompt), macros = scanVariables(before);
    if (macros.some(m => m.scope === scope && m.name === newName)) throw new Error('该作用域已存在「'+newName+'」，请使用其他名称，避免合并不同变量');
    let after = before;
    for (const m of macros.filter(m => m.scope === scope && m.name === oldName).reverse()) {
      // Replace only the name span, so nested macros and original kind/value formatting survive.
      const rawName = before.slice(m.nameStart, m.nameEnd);
      const replacement = rawName.replace(rawName.trim(), () => newName);
      after = after.slice(0, m.nameStart) + replacement + after.slice(m.nameEnd);
    }
    if (before !== after) changes.push(change(prompt, after));
  }
  return changes;
}

export function collectVariables(prompts) {
  const groups = new Map();
  for (const prompt of prompts.filter(p => !p.marker)) for (const macro of scanVariables(content(prompt))) {
    const key = variableKey(macro);
    if (!groups.has(key)) groups.set(key, {key, scope:macro.scope, name:macro.name, occurrences:[]});
    groups.get(key).occurrences.push({...macro, id:prompt.identifier, entryName:prompt.name || '(未命名)'});
  }
  return [...groups.values()];
}

export function missingVariableInitializers(prompts, targetId) {
  const target = entry(prompts, targetId);
  const present = new Set(scanVariables(content(target)).filter(m => m.kind.startsWith('set')).map(variableKey));
  return collectVariables(prompts).filter(group => !present.has(group.key) && group.occurrences.some(m => m.id !== targetId && /^(set|add)/.test(m.kind)));
}

export function planVariableInitializers(prompts, targetId, keys) {
  const target = entry(prompts, targetId);
  const missing = missingVariableInitializers(prompts, targetId).filter(g => !keys || keys.includes(g.key));
  let after = content(target);
  for (const group of missing) after = appendVariableText(after, makeVariable(group.scope === 'global' ? 'setglobalvar' : 'setvar', group.name));
  return after === content(target) ? [] : [change(target, after)];
}

export function applyVariableChanges(prompts, changes) {
  const seen = new Set();
  for (const item of changes) {
    if (seen.has(item.id) || content(entry(prompts, item.id)) !== item.before) throw new Error('预览后条目已变化，请重新预览');
    seen.add(item.id);
  }
  const replacements = new Map(changes.map(item => [item.id, item.after]));
  return prompts.map(p => replacements.has(p.identifier) ? {...p, content:replacements.get(p.identifier)} : p);
}
