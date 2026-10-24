// 酒馆自动解析设置适配：按白名单更新原生数据，独立同步控件，保留条件回滚能力。
import {FULL_REASONING_FIELDS, REASONING_SWITCHES, reasoningFields, captureFullSnapshotReasoning, normalizeSnapshotReasoning, sameSnapshotReasoning} from '../features/snapshot/snapshot-reasoning.js';

let pendingSync = null;
const formatNotes = new WeakMap();

function syncReasoningControls(powerUser, cachedSelect, sourceName) {
  pendingSync?.disconnect();
  pendingSync = null;
  const sync = () => {
    const value = powerUser.reasoning;
    // The preset manager retains TT's original select while the drawer is parked.
    const parkedRoot = cachedSelect?.getRootNode?.();
    let complete = true;
    for (const key of FULL_REASONING_FIELDS) {
      const id = key === 'name' ? 'reasoning_select' : 'reasoning_' + key;
      const control = document.getElementById(id) || parkedRoot?.querySelector?.('#' + id);
      if (!control) {complete = false; continue;}
      if (REASONING_SWITCHES.includes(key)) control.checked = value[key];
      else if (key === 'name') {
        control.value = value.name || '';
        // Native template actions assume every option belongs to the real array.
        // Never invent an option for a deleted template (native delete uses its index).
        let note = formatNotes.get(control);
        if (sourceName && sourceName !== value.name) {
          if (!note) {
            note = document.createElement('small');note.dataset.pcmReasoningNote='';
            note.style.flexBasis='100%';formatNotes.set(control,note);
            control.addEventListener('change',()=>note.remove());
          }
          note.textContent='当前格式来自快照（原模板：'+sourceName+'）；上方仍为酒馆已有模板。';
          control.parentNode.append(note);
        } else note?.remove();
      } else control.value = value[key];
    }
    return complete;
  };
  if (sync()) return;
  // TT may park this drawer's content. Observe only its stable root until the
  // controls return, using the latest native values rather than replaying a binding.
  const root = document.getElementById('AdvancedFormatting');
  if (!root) return;
  pendingSync = new MutationObserver(() => {
    if (FULL_REASONING_FIELDS.every(key => document.getElementById(key === 'name' ? 'reasoning_select' : 'reasoning_' + key))) {
      pendingSync?.disconnect(); pendingSync = null; sync();
    }
  });
  pendingSync.observe(root, {childList:true, subtree:true});
}

export async function snapshotReasoningEnvironment() {
  let powerUser, reasoningModule;
  try {
    [powerUser,reasoningModule] = await Promise.all([
      import('/scripts/power-user.js').then(module=>module.power_user), import('/scripts/reasoning.js'),
    ]);
  }
  catch {throw new Error('当前酒馆无法读取自动解析设置，请更新酒馆后重试');}
  if (!powerUser?.reasoning) throw new Error('酒馆自动解析设置尚未就绪');
  captureFullSnapshotReasoning(powerUser.reasoning);
  let cachedSelect;
  try {cachedSelect = (await import('/scripts/preset-manager.js')).getPresetManager?.('reasoning')?.select?.[0];}
  catch { /* Older hosts can still synchronize their mounted drawer. */ }
  return {
    current:() => captureFullSnapshotReasoning(powerUser.reasoning),
    matches:binding => sameSnapshotReasoning(powerUser.reasoning, binding),
    apply(binding) {
      const saved = normalizeSnapshotReasoning(binding), before = captureFullSnapshotReasoning(powerUser.reasoning);
      const fields = reasoningFields(saved);
      const syncChat = () => {
        if (saved.version !== 2) return;
        for (const block of document.querySelectorAll('details.mes_reasoning_details')) block.open = powerUser.reasoning.auto_expand;
        const chat = document.getElementById('chat');
        if (powerUser.reasoning.show_hidden) chat?.setAttribute('data-show-hidden-reasoning','true');
        else chat?.removeAttribute('data-show-hidden-reasoning');
      };
      const names=(reasoningModule.reasoning_templates || []).map(template=>template.name).filter(name=>typeof name==='string'&&name);
      if(!names.includes(saved.name))saved.name=names.includes(before.name)?before.name:(names[0] || '');
      for (const key of fields) powerUser.reasoning[key] = saved[key];
      syncReasoningControls(powerUser, cachedSelect, binding.name);
      syncChat();
      return () => {
        // Never overwrite an intervening native edit during a failed save.
        if (!sameSnapshotReasoning(powerUser.reasoning, saved)) throw new Error('自动解析已被另外修改，请检查当前设置');
        for (const key of fields) powerUser.reasoning[key] = before[key];
        syncReasoningControls(powerUser, cachedSelect);
        syncChat();
      };
    },
  };
}

export async function readSnapshotReasoning(binding) {
  const env = await snapshotReasoningEnvironment();
  let templates;
  try {templates = (await import('/scripts/reasoning.js')).reasoning_templates;}
  catch {throw new Error('当前酒馆无法读取推理格式模板，请更新酒馆后重试');}
  return {
    binding:binding === undefined ? null : normalizeSnapshotReasoning(binding),
    current:env.current(),
    templates:(Array.isArray(templates) ? templates : []).filter(item => item
      && ['name','prefix','suffix','separator'].every(key => typeof item[key] === 'string'))
      .map(({name,prefix,suffix,separator}) => ({name,prefix,suffix,separator})),
  };
}
