// 快照的预设引用迁移。原生改名必须有前后两个事件和服务器目录佐证；手动选择复用同一份引用更新。
import {snapshotScope, validateSnapshot} from '../features/snapshot/snapshot.js';

export function snapshotPresetNames(manager) {
  const {preset_names:names} = manager.getPresetList();
  if (!names || typeof names !== 'object') throw Error('酒馆预设目录尚未就绪');
  const list = Array.isArray(names) ? [...names] : Object.keys(names);
  if (!list.length || list.some(name=>typeof name !== 'string' || !name.trim())) throw Error('酒馆预设目录为空或尚未就绪');
  return list;
}

function retargetSnapshot(snapshot, oldName, newName) {
  if (!snapshot || !snapshotScope(snapshot).preset || snapshot.presetName !== oldName) throw Error('快照的预设已变化，请刷新后重新选择');
  if (typeof newName !== 'string' || !newName.trim() || newName === oldName) throw Error('请选择另一个预设');
  const next = {...snapshot, presetName:newName, updatedAt:Date.now()};
  if (snapshot.presetRegex) {
    const regex = snapshot.presetRegex;
    if (regex.owner?.apiId !== 'openai' || regex.owner.presetName !== oldName) throw Error('预设正则归属不一致，请检查快照');
    next.presetRegex = {...regex, owner:{...regex.owner, presetName:newName}};
  }
  return validateSnapshot(next);
}

export async function saveRetargetedSnapshots(store, ids, oldName, newName, save, checkTarget) {
  const previous = store.snapshots;
  let count = 0;
  const next = previous.map(snapshot => {
    if (!ids.has(snapshot.id) || snapshot.presetName !== oldName || !snapshotScope(snapshot).preset) return snapshot;
    count++;
    const updated = retargetSnapshot(snapshot, oldName, newName);
    checkTarget?.(updated);
    return updated;
  });
  if (!count) return 0;
  store.snapshots = next;
  try { await save(); } catch (error) {store.snapshots = previous; throw error;}
  return count;
}

// Windows 文件名也可能仅大小写不同。只用此比较排除重名，不用它寻找替代预设。
function unambiguous(names, present, absent) {
  const key = name => name.normalize('NFC').toLowerCase();
  return names.includes(present) && names.filter(n=>key(n)===key(present)).length===1 && !names.some(n=>key(n)===key(absent));
}

export function watchSnapshotPresetRenames({script, environment, storeFor, diskNames, serial, save, pendingSave, notify}) {
  const before = script.event_types?.PRESET_RENAMED_BEFORE, after = script.event_types?.PRESET_RENAMED;
  if (!before || !after) return;
  let pending;
  let completion = Promise.resolve();
  const warn = message => notify('warning', message+'。请刷新快照列表核对，原预设缺失时可点击名称旁的警示标志重新指定。');
  script.eventSource.on(before, async event => {
    if (event?.apiId !== 'openai') return;
    const {oldName, newName} = event;
    const ticket = {oldName,newName};
    pending = ticket;
    if (!oldName || !newName || oldName===newName) return;
    try {
      await completion;
      const env = await environment(), store = storeFor(env);
      ticket.ids = new Set((store?.snapshots||[]).filter(s=>s.presetName===oldName && snapshotScope(s).preset).map(s=>s.id));
      if (!ticket.ids.size) return;
      ticket.store = store;
      ticket.ready = unambiguous(snapshotPresetNames(env.manager),oldName,newName) && unambiguous(await diskNames(env),oldName,newName);
    } catch { ticket.ready = false; }
  });
  script.eventSource.on(after, event => {
    if (event?.apiId !== 'openai') return;
    const ticket = pending;
    if (!ticket || ticket.oldName!==event.oldName || ticket.newName!==event.newName) return;
    pending = null;
    if (!ticket.ids?.size) return;
    const {oldName,newName} = ticket;
    if (!ticket.ready) {warn('原名称或目标名称存在歧义，或改名前的预设目录无法核实');return;}
    // 酒馆的事件总线会等待监听器。允许酒馆先完成它自己的收尾；若紧接着再改名，上面的前置事件会等此次迁移。
    completion = serial(async () => {
      const env = await environment(), store = storeFor(env);
      if (store!==ticket.store || !unambiguous(await diskNames(env,store),newName,oldName) || !unambiguous(snapshotPresetNames(env.manager),newName,oldName)) {
        warn('无法确认「'+oldName+'」已改名为「'+newName+'」');return;
      }
      const count = await saveRetargetedSnapshots(store,ticket.ids,oldName,newName,()=>save(env));
      if (!count) return;
      const status = pendingSave(store);
      if (status) notify('warning',status.message);
      else notify('success','已同步 '+count+' 份快照：'+oldName+' → '+newName);
    }).catch(error=>warn('快照预设名称未确认同步：'+error.message));
  });
}
