// 世界书缝合纯逻辑：读取导出格式，将所选条目转换并插入预设；不执行正文或改写来源。
import { clone, createIdentifier, findPromptOrderEntry, validatePreset } from './core.js';

export function readWorldbook(data, source = '世界书') {
  const entries = data?.entries ?? data?.character_book?.entries ?? data?.data?.character_book?.entries;
  if (!entries || typeof entries !== 'object') throw new Error('不是有效的世界书：缺少 entries。请导入世界书 JSON，而非酒馆助手脚本。');
  return Object.entries(entries).map(([key, entry], index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.content !== 'string') {
      throw new Error(`世界书条目 ${key} 缺少有效正文 content。`);
    }
    return {
      key, source, name: String(entry.comment || entry.name || `未命名条目 ${key}`),
      content: entry.content,
      enabled: entry.disable !== true && entry.disabled !== true && entry.enabled !== false,
      role: entry.role ?? entry.extensions?.role,
      // 显示顺序优先；无显示序号时保持文件中的稳定顺序。
      displayIndex: Number.isFinite(entry.displayIndex) ? entry.displayIndex : index,
    };
  }).sort((a, b) => a.displayIndex - b.displayIndex);
}

export function stitchWorldbook(preset, entries, { beforeId = null, afterId = null, placement = 'end', keepDisabled = true } = {}) {
  validatePreset(preset);
  if (!Array.isArray(entries) || !entries.length) throw new Error('请先勾选要缝合的世界书条目。');
  // 先完整构造结果，任何校验失败都不触碰目标草稿。
  const result = clone(preset);
  let orderNode = findPromptOrderEntry(result);
  const idOf = item => typeof item === 'string' ? item : item?.identifier;
  const existingIds = new Set(result.prompts.map(prompt => prompt.identifier));
  const activeIds = (orderNode?.order || []).map(idOf).filter(id => existingIds.has(id));
  if (beforeId !== null && afterId !== null) throw new Error('不能同时指定条目前后两个插入位置。');
  let anchor = beforeId ?? afterId;
  let after = afterId !== null;
  if (anchor !== null && !activeIds.includes(anchor)) {
    throw new Error('插入位置已失效，请重新打开世界书面板。');
  }
  if (anchor === null) {
    if (!['start', 'end'].includes(placement)) throw new Error('无效的插入位置。');
    anchor = (placement === 'start' ? activeIds[0] : activeIds.at(-1)) ?? null;
    after = placement === 'end';
  }
  const ids = new Set(result.prompts.map(prompt => prompt.identifier));
  const prompts = entries.map(entry => {
    if (!entry || typeof entry.content !== 'string') throw new Error('所选世界书条目正文无效。');
    let identifier;
    do { identifier = `worldbook_${createIdentifier()}`; } while (ids.has(identifier));
    ids.add(identifier);
    const role = ['system', 'user', 'assistant'].includes(entry.role) ? entry.role
      : ({ 0: 'system', 1: 'user', 2: 'assistant' })[entry.role] || 'system';
    return {
      identifier, name: String(entry.name || '未命名条目'), content: entry.content,
      role, enabled: !keepDisabled || entry.enabled !== false,
      system_prompt: false, marker: false, injection_position: 0, injection_depth: 4,
      injection_order: 100, injection_trigger: [], forbid_overrides: false,
    };
  });
  if (!orderNode) {
    orderNode = { character_id: 100001, order: [] };
    result.prompt_order.push(orderNode);
  }
  const at = anchor === null ? (placement === 'start' ? 0 : orderNode.order.length)
    : orderNode.order.findIndex(item => idOf(item) === anchor) + Number(after);
  orderNode.order.splice(at, 0, ...prompts.map(({ identifier, enabled }) => ({ identifier, enabled })));
  const promptAt = anchor === null ? (placement === 'start' ? 0 : result.prompts.length)
    : result.prompts.findIndex(prompt => prompt.identifier === anchor) + Number(after);
  result.prompts.splice(promptAt, 0, ...prompts);
  // 按选中的条目继承归属，而非看下一条：组尾「之后」不能跑入下一组。
  const groups = result.extensions?.baibaiToolkit?.presetPromptGroups;
  const groupId = groups?.prompts?.[anchor]?.groupId;
  if (groupId != null && Array.isArray(groups?.groups) && groups.groups.some(group => String(group.id) === String(groupId))) {
    for (const prompt of prompts) groups.prompts[prompt.identifier] = { groupId: String(groupId) };
  }
  return { preset: result, identifiers: prompts.map(prompt => prompt.identifier) };
}
