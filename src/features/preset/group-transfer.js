// 整个预设分组的不可变排序/迁移：保持来源、未知字段和未注入条目。
import { clone, createIdentifier, findPromptOrderEntry } from './core.js';
const idOf = item => typeof item === 'string' ? item : item?.identifier;
const metadata = preset => preset?.extensions?.baibaiToolkit?.presetPromptGroups;
export function transferPresetGroup(source, target, groupId, beforeId = null) {
  if (!source || !target) throw new Error('请先导入两侧预设');
  const sourceMeta = metadata(source), group = sourceMeta?.groups?.find(g => String(g.id) === groupId);
  if (!group) throw new Error('来源分组已变化');
  const result = { ...target, prompts: target.prompts.slice(), prompt_order: clone(target.prompt_order || []), extensions: clone(target.extensions || {}) };
  const sourceEntry = findPromptOrderEntry({ ...source, prompt_order: source.prompt_order || [] });
  let entry = findPromptOrderEntry(result);
  if (!entry) { entry = { character_id: 100001, order: [] }; result.prompt_order.push(entry); }
  if (!entry.order.length) entry.order = target.prompts.map(p=>({identifier:p.identifier,enabled:p.enabled!==false}));
  const sourceIds = new Set(source.prompts.filter(p => String(sourceMeta.prompts?.[p.identifier]?.groupId) === groupId).map(p => p.identifier));
  if (!sourceIds.size) throw new Error('分组中没有条目');
  const srcOrder = sourceEntry?.order?.length ? sourceEntry.order : source.prompts.map(p => ({ identifier: p.identifier, enabled: p.enabled !== false }));
  const sourceOrder = [...new Set([...srcOrder.map(idOf), ...source.prompts.map(p => p.identifier)])].filter(id => sourceIds.has(id));
  const ext = result.extensions.baibaiToolkit ??= {};
  const meta = ext.presetPromptGroups ??= { groups: [], prompts: {} };
  meta.groups ??= []; meta.prompts ??= {};
  const sameSide = source === target;
  const moving = sameSide ? sourceIds : new Set();
  const originalOrder = entry.order;
  if (beforeId != null && !originalOrder.some(item => idOf(item) === beforeId)) throw new Error('目标位置已变化');
  if (source === target && moving.has(beforeId)) return target;
  if (moving.has(beforeId)) { const at = originalOrder.findIndex(item => idOf(item) === beforeId); beforeId = originalOrder.slice(at).map(idOf).find(id => !moving.has(id)) ?? null; }
  const rest = originalOrder.filter(item => !moving.has(idOf(item)));
  const index = beforeId == null ? rest.length : rest.findIndex(item => idOf(item) === beforeId);
  // A boundary cannot cut any named group, even when legacy metadata is interleaved.
  const known = new Set(meta.groups.map(g => String(g.id)));
  const groupOf = item => { const id = String(meta.prompts[idOf(item)]?.groupId); return known.has(id) ? id : null; };
  const left = new Set(rest.slice(0,index).map(groupOf).filter(Boolean));
  if (rest.slice(index).some(item => left.has(groupOf(item)))) throw new Error('整组只能放到分组之间');
  const reserved = new Set([...target.prompts.map(p=>p.identifier), ...sourceOrder]);
  const mapping = new Map(sourceOrder.map(id=>[id,id]));
  if (!sameSide) for (const id of sourceOrder) if (target.prompts.some(p=>p.identifier===id)) { let fresh; do { fresh=createIdentifier(); } while(reserved.has(fresh));reserved.add(fresh);mapping.set(id,fresh); }
  const incoming = srcOrder.filter(item => sourceIds.has(idOf(item))).map(item=>typeof item==='string'?mapping.get(item):{...clone(item),identifier:mapping.get(idOf(item))});
  entry.order = [...rest.slice(0,index), ...incoming, ...rest.slice(index)];
  const sourceMap = new Map(source.prompts.map(p => [p.identifier,p]));
  const targetMap = new Map(target.prompts.map(p => [p.identifier,p]));
  let destinationGroupId=groupId;
  const newGroup=clone(group);
  if(!sameSide){
    const used=new Set(meta.groups.map(g=>String(g.id)));
    do{destinationGroupId=createIdentifier();}while(used.has(destinationGroupId));
    newGroup.id=destinationGroupId;
    const names=new Set(meta.groups.map(g=>String(g.name||'').trim()));
    const base=String(group.name||groupId).trim();let name=base,n=1;
    while(names.has(name))name=base+'（'+n+++'）';newGroup.name=name;
  }
  for (const id of sourceOrder) { const mapped=mapping.get(id);targetMap.set(mapped, sameSide ? sourceMap.get(id) : {...clone(sourceMap.get(id)),identifier:mapped});Object.defineProperty(meta.prompts,mapped,{value:{...clone(sourceMeta.prompts[id]),groupId:destinationGroupId},enumerable:true,writable:true,configurable:true}); }
  if(!sameSide)meta.groups.push(newGroup);
  const allIds = [...new Set([...entry.order.map(idOf), ...target.prompts.map(p=>p.identifier), ...sourceOrder.map(id=>mapping.get(id))])];
  result.prompts = allIds.map(id => targetMap.get(id)).filter(Boolean);
  const groupIds = [...new Set(entry.order.map(item=>String(meta.prompts[idOf(item)]?.groupId)))];
  meta.groups.sort((a,b) => { const x=groupIds.indexOf(String(a.id)),y=groupIds.indexOf(String(b.id)); return (x<0?Infinity:x)-(y<0?Infinity:y); });
  meta.groups.forEach((g,i)=>{g.order=i;});
  return result;
}
