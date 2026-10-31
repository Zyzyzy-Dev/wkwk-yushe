// 编辑器预设分组独立供电开关：仅修改柏宝箱组enabled，不改变条目或顺序记录。
export function setPresetGroupEnabled(preset,groupId,enabled){
  const toolkit=preset?.extensions?.baibaiToolkit,meta=toolkit?.presetPromptGroups;
  const matches=(meta?.groups||[]).filter(group=>String(group.id)===String(groupId));
  if(matches.length!==1)throw new Error('分组已变化或标识重复，请重新读取');
  const group=matches[0];
  return {...preset,extensions:{...preset.extensions,baibaiToolkit:{...toolkit,presetPromptGroups:{...meta,groups:meta.groups.map(item=>item===group?{...item,enabled:!!enabled}:item)}}}};
}
