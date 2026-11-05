// 快照与 API 各自的单层目录；校验归组及整组移除计划，宿主负责原子保存与绑定清理。
export const libraryFingerprint=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function validateLibraryFolders(current, expected, draft, items){
  if(JSON.stringify(current??[])!==JSON.stringify(expected))throw Error('分组已被其他操作修改，请刷新列表后重新整理');
  if(!Array.isArray(draft)||draft.length>200)throw Error('最多创建 200 个分组');
  const available=new Set(items.map(item=>item.id)),ids=new Set(),names=new Set(),used=new Set();
  return draft.map(f=>{
    if(typeof f?.id!=='string'||!f.id||f.id.length>200||ids.has(f.id))throw Error('分组标识无效或重复');
    const name=typeof f.name==='string'?f.name.trim():'';
    if(!name||name.length>80||name==='未分组'||names.has(name))throw Error('请输入不重复的分组名（1–80 字，不能为“未分组”）');
    if(!Array.isArray(f.items)||f.items.length>available.size)throw Error('分组成员列表无效或成员已删除，请刷新');
    for(const id of f.items){if(!available.has(id)||used.has(id))throw Error('成员已删除或重复归组，请刷新');used.add(id);}
    ids.add(f.id);names.add(name);return {id:f.id,name,items:[...f.items]};
  });
}
export function moveLibraryItems(folders,ids,to){
  if(to&&!folders.some(f=>f.id===to))throw Error('目标组已不存在');
  const selected=new Set(ids);
  return folders.map(f=>({...f,items:f.id===to?[...f.items,...[...selected].filter(id=>!f.items.includes(id))]:f.items.filter(id=>!selected.has(id))}));
}
export function removeLibraryFolder(current,payload,items){
  validateLibraryFolders(current,payload.expected,current||[],items);
  const folder=current?.find(f=>f.id===payload.id);
  if(!folder)throw Error('分组已不存在，请刷新');
  if(typeof payload.deleteItems!=='boolean')throw Error('请选择解除分组或删除分组及方案');
  const removed=new Set(payload.deleteItems?folder.items:[]);
  if(payload.deleteItems){
    const members=folder.items.map(id=>items.find(i=>i.id===id));
    if(libraryFingerprint(members)!==libraryFingerprint(payload.expectedItems))throw Error('组中方案已变化，请重新打开删除窗口');
  }
  return {folders:current.filter(f=>f.id!==folder.id),items:items.filter(i=>!removed.has(i.id)),removed};
}
