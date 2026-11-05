// 迁移预览计划的纯手动排序；不会读写当前编辑器预设。
import { findPromptOrderEntry } from './core.js';
const idOf = row => typeof row === 'string' ? row : row?.identifier;
export function moveMigrationEntry(plan, id, {beforeId = null, groupId = ''} = {}) {
  if (!plan?.result || plan.errors?.length || !plan.entries?.some(entry => entry.id === id && entry.injected)) throw Error('只能拖动本次迁入的已注入条目');
  // History keeps immutable plans. Share prompt bodies and untouched fields between drag steps.
  const preset={...plan.result}, orig=findPromptOrderEntry(preset);
  const node=orig&&{...orig,order:[...orig.order]};
  if(node)preset.prompt_order=preset.prompt_order.map(n=>n===orig?node:n);
  const next={...plan,result:preset,entries:plan.entries.map(e=>({...e})),previewOrder:plan.previewOrder.map(e=>e.id===id?{...e}:e)};
  const from = node?.order.findIndex(row => idOf(row) === id);
  if (from == null || from < 0) throw Error('迁入条目已变化，请重新预览');
  if (beforeId !== null && !node.order.some(row => idOf(row) === beforeId)) throw Error('只能放到已注入条目的位置');
  const meta = preset.extensions?.baibaiToolkit?.presetPromptGroups;
  const group = groupId ? meta?.groups?.find(group => group.id === groupId) : null;
  if (groupId && !group) throw Error('目标分组已不存在');
  const initialGroup=meta?.prompts && Object.hasOwn(meta.prompts,id)?meta.prompts[id]?.groupId||'':'';
  if (beforeId === id || ((idOf(node.order[from+1])??null)===beforeId&&initialGroup===groupId)) return plan;
  const [row] = node.order.splice(from, 1), at = beforeId === null ? node.order.length : node.order.findIndex(row => idOf(row) === beforeId);
  const groupFor = row => {const key=idOf(row);return meta?.prompts && Object.hasOwn(meta.prompts,key) ? meta.prompts[key]?.groupId || '' : '';};
  const left = groupFor(node.order[at-1]), right = groupFor(node.order[at]);
  if (left && left === right && left !== groupId) throw Error('请放到目标分组内部或分组边界');
  node.order.splice(at, 0, row);
  if (meta && (groupId || Object.hasOwn(meta.prompts,id))) {
    const member = {...(Object.hasOwn(meta.prompts,id) ? meta.prompts[id] : {})};
    if (groupId) member.groupId = groupId; else delete member.groupId;
    const updated={...meta,prompts:{...meta.prompts,[id]:member}};
    preset.extensions={...preset.extensions,baibaiToolkit:{...preset.extensions.baibaiToolkit,presetPromptGroups:updated}};
  }
  const moved = next.entries.find(entry => entry.id === id);
  moved.groupId = groupId; moved.groupName = String(group?.name || '未分组');
  const ordered = node.order.map(idOf), previewById = new Map(next.previewOrder.map(entry => [entry.id,entry]));
  next.previewOrder = [...ordered.map(key => previewById.get(key)), ...next.previewOrder.filter(entry => !entry.injected)];
  Object.assign(previewById.get(id),{groupName:moved.groupName});
  for (const entry of next.entries) {
    const index = ordered.indexOf(entry.id); entry.beforeId = ordered[index+1] ?? null; entry.afterId = ordered[index-1] ?? null;
  }
  return next;
}
