// 快照推理设置：v1 保留旧解析绑定范围，v2 捕获完整推理选项与格式副本。
export const REASONING_FIELDS = ['auto_parse', 'name', 'prefix', 'suffix', 'separator'];
export const REASONING_SWITCHES = ['auto_parse','auto_expand','show_hidden','add_to_prompts'];
export const FULL_REASONING_FIELDS = [...REASONING_FIELDS,'auto_expand','show_hidden','add_to_prompts','max_additions'];
export const reasoningFields = value => value.version === 2 ? FULL_REASONING_FIELDS : REASONING_FIELDS;

export function normalizeSnapshotReasoning(value) {
  if (!value || ![1,2].includes(value.version) || typeof value.auto_parse !== 'boolean'
    || ['name', 'prefix', 'suffix', 'separator'].some(key => typeof value[key] !== 'string')) {
    throw new Error('自动解析设置无效，请重新绑定');
  }
  if (value.version === 2 && (REASONING_SWITCHES.some(key => typeof value[key] !== 'boolean')
    || !Number.isInteger(value.max_additions) || value.max_additions < 0 || value.max_additions > 999)) throw new Error('推理设置无效，请检查开关与最大值（0–999）');
  return {version:value.version, ...Object.fromEntries(reasoningFields(value).map(key => [key, value[key]]))};
}

export function captureFullSnapshotReasoning(reasoning) {
  return normalizeSnapshotReasoning({...reasoning, name:reasoning?.name ?? '', version:2});
}

export function captureSnapshotReasoning(reasoning) {
  return normalizeSnapshotReasoning({...reasoning, name:reasoning?.name ?? '', version:1});
}

export function sameSnapshotReasoning(reasoning, binding) {
  try {
    const saved = normalizeSnapshotReasoning(binding);
    return reasoningFields(saved).every(key => reasoning?.[key] === saved[key]);
  } catch {return false;}
}
