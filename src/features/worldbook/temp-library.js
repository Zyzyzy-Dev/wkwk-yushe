// 世界书临时材料的内存副本与预设插入；不持久化、不执行正文、不改来源。
import { stitchWorldbook } from './worldbook.js';

export function createTempLibrarySession() {
  return { items: new Map(), query: '', expanded: new Set() };
}

export function addTempLibraryEntries(session, entries, { keepDisabled = true } = {}) {
  const pending = new Map(); let skipped = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.content !== 'string' || entry.key == null) throw Error('所选世界书条目正文或标识无效。');
    const source = String(entry.source || '世界书'), key = String(entry.key), id = JSON.stringify([source, key]);
    if (session.items.has(id) || pending.has(id)) { skipped++; continue; }
    pending.set(id, Object.freeze({ id, source, key, name: String(entry.name || '未命名条目'), content: entry.content,
      role: entry.role, enabled: !keepDisabled || entry.enabled !== false }));
  }
  for (const [id, item] of pending) session.items.set(id, item);
  return { added: pending.size, skipped };
}

export function prepareTempLibraryInsert(preset, item, placement = {}) {
  const hasGroup = Object.prototype.hasOwnProperty.call(placement, 'groupId'), groupId = String(placement.groupId || '');
  const originalGroups = preset.extensions?.baibaiToolkit?.presetPromptGroups;
  if (hasGroup && groupId && !originalGroups?.groups?.some(group => String(group.id) === groupId)) throw Error('目标分组已失效，请重新拖拽。');
  const result = stitchWorldbook(preset, [item], placement);
  const originals = new Map(preset.prompts.map(prompt => [prompt.identifier, prompt]));
  const next = { ...preset, prompts: result.preset.prompts.map(prompt => originals.get(prompt.identifier) || prompt), prompt_order: result.preset.prompt_order };
  // 只替换确实需要改变的分组元数据；保留正文和正则对象，避免 WeakMap 表单草稿脱落。
  if (originalGroups) {
    const groups = result.preset.extensions.baibaiToolkit.presetPromptGroups;
    if (!groups.prompts) groups.prompts = {};
    if (hasGroup) for (const id of result.identifiers) {
      if (groupId) groups.prompts[id] = { groupId }; else delete groups.prompts[id];
    }
    next.extensions = { ...preset.extensions, baibaiToolkit: { ...preset.extensions.baibaiToolkit, presetPromptGroups: groups } };
  }
  return { preset: next, identifiers: result.identifiers };
}
