// 单次列表渲染的顺序索引：替代逐条扫描，不跨修改缓存预设状态。
export function indexPromptOrder(order) {
  const entries = new Map();
  for (const item of Array.isArray(order) ? order : []) {
    const id = typeof item === 'string' ? item : item?.identifier;
    // 与旧 find 行为一致：重复 ID 使用首次出现的开关值。
    if (!entries.has(id)) entries.set(id, item);
  }
  return { entries, allInjected: !order?.length };
}

export function indexedPromptEnabled(index, prompt) {
  const item = index.entries.get(prompt.identifier);
  return typeof item === 'object' && item && typeof item.enabled === 'boolean' ? item.enabled : prompt.enabled !== false;
}

export function indexedPromptInjected(index, prompt) {
  return index.allInjected || index.entries.has(prompt.identifier);
}
