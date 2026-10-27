// 预设分组解除／删除：保留未受影响条目对象，供正文草稿与撤回继续引用。
import {clone} from '../../shared/clone.js';

export function removePresetGroup(preset,groupId,{deleteEntries=false}={}){
  const groups=preset?.extensions?.baibaiToolkit?.presetPromptGroups;
  const key=String(groupId);
  if(!groups?.groups?.some(group=>String(group.id)===key))throw new Error('分组已变化，请重新选择');
  const members=new Set(Object.entries(groups.prompts||{}).filter(([,meta])=>String(meta?.groupId)===key).map(([id])=>id));
  const removedIds=deleteEntries?preset.prompts.filter(prompt=>members.has(prompt.identifier)).map(prompt=>prompt.identifier):[];
  const next={...preset,extensions:clone(preset.extensions)};
  const nextGroups=next.extensions.baibaiToolkit.presetPromptGroups;
  nextGroups.groups=nextGroups.groups.filter(group=>String(group.id)!==key);
  for(const id of members)delete nextGroups.prompts[id];
  if(deleteEntries){
    next.prompts=preset.prompts.filter(prompt=>!members.has(prompt.identifier));
    if(Array.isArray(preset.prompt_order))next.prompt_order=preset.prompt_order.map(entry=>
      Array.isArray(entry?.order)?{...entry,order:entry.order.filter(item=>!members.has(typeof item==='string'?item:item?.identifier))}:entry);
  }
  return {preset:next,removedIds};
}
