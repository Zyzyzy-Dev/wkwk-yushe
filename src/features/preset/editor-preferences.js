// 预设编辑偏好：仅接受布尔开关，导入折叠只初始化编辑器视图，不写入预设元数据。
export const EDITOR_PREFERENCES_KEY = 'preset_compare_editor_preferences';
export const EDITOR_DEFAULTS = Object.freeze({collapseGroups:false, quickReply:false, floating:false, creatorMode:false});

export function normalizeEditorPreferences(value, patch) {
  return Object.fromEntries(Object.entries(EDITOR_DEFAULTS).map(([key, fallback]) =>
    [key, typeof patch?.[key] === 'boolean' ? patch[key] : typeof value?.[key] === 'boolean' ? value[key] : fallback]));
}

export function initializeImportedGroups(collapsed, side, preset, enabled) {
  const prefix = `g:${side}:`;
  for (const key of Object.keys(collapsed)) if (key.startsWith(prefix)) delete collapsed[key];
  const groups=preset?.extensions?.baibaiToolkit?.presetPromptGroups?.groups;
  for (const group of Array.isArray(groups) ? groups : []) {
    if (group?.id != null) collapsed[prefix + group.id] = !!enabled;
  }
}
