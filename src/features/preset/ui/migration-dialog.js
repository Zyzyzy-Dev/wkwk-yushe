// 一键迁移窗口：固定顶栏、分组勾选、正文只读的可拖动预览，一次应用到新版草稿。
import { analyzeMigration, planMigration } from '../migration.js';
import { findPromptOrderEntry } from '../core.js';
import { moveMigrationEntry } from '../migration-order.js';
import { installMigrationDrag } from './migration-drag.js';

let dialogSequence = 0;
const nameOf = item => String(item?.name || '未命名条目');
const idOf = item => typeof item === 'string' ? item : item?.identifier;
const orderRows = preset => new Map((findPromptOrderEntry({ ...preset, prompt_order: preset?.prompt_order || [] })?.order || []).map(row => [idOf(row), row]));
const enabledOf = (prompt, rows) => {
  const row = rows.get(prompt.identifier);
  return row && typeof row === 'object' && typeof row.enabled === 'boolean' ? row.enabled : prompt.enabled !== false;
};

export function openMigrationDialog({ parent, source, target, targetPreview = target, sourceName, targetName, ignoreWhitespace = false, isCurrent, onApply, onClose }) {
  if (!parent?.isConnected || parent.querySelector('.pcm-migration-modal')) return { close() {} };
  const doc = parent.ownerDocument, previousFocus = doc.activeElement, sequence = ++dialogSequence;
  let disclosureSequence = 0;
  const node = (tag, className = '', text) => {
    const element = doc.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (text, key, action, className = 'menu_button') => {
    const element = node('button', className, text);
    element.type = 'button'; element.setAttribute(`data-migration-${key}`, '');
    element.addEventListener('click', action); return element;
  };
  const checkbox = (label, key, id) => {
    const control = node('input', 'pcm-migration-checkbox'); control.type = 'checkbox';
    control.setAttribute('aria-label', label); control.setAttribute(`data-migration-${key}`, id); return control;
  };
  function disclosure(control, body, caret) {
    body.id = `pcm-migration-body-${sequence}-${++disclosureSequence}`;
    control.setAttribute('aria-controls', body.id);
    const sync = () => {
      control.setAttribute('aria-expanded', String(!body.hidden));
      if (caret) caret.textContent = body.hidden ? '▶' : '▼';
    };
    sync(); control.addEventListener('click', () => { body.hidden = !body.hidden; sync(); });
  }
  function promptDisclosure(control, container, prompt, key) {
    const body = node('pre', 'pcm-migration-content'); body.hidden = true;
    body.setAttribute(`data-migration-${key}`, prompt.identifier); body.setAttribute('aria-label', `${nameOf(prompt)}正文（只读）`);
    let mounted = false;
    control.addEventListener('click', () => {
      if (!mounted) { mounted = true; body.textContent = typeof prompt.content === 'string' && prompt.content ? prompt.content : '（空正文）'; }
    });
    disclosure(control, body); container.append(body);
  }
  function readonlySwitch(enabled, name, key, id, group = false) {
    const control = node('span', group ? 'pcm-group-gate pcm-migration-readonly-switch' : `pcm-switch pcm-migration-readonly-switch ${enabled ? 'pcm-op-enabled' : 'pcm-op-disabled'}`);
    control.setAttribute('role', 'switch'); control.setAttribute('aria-checked', String(enabled)); control.setAttribute('aria-readonly', 'true');
    control.setAttribute('aria-label', `${name}开关（只读）`); control.setAttribute(`data-migration-${key}`, id);
    control.title = `${enabled ? '已开启' : '已关闭'}（只读）`;
    const track = node('span', group ? 'pcm-group-power-track' : 'pcm-switch-track');
    track.append(node('span', group ? 'pcm-group-power-knob' : 'pcm-switch-knob')); control.append(track);
    return control;
  }
  let disposed = false, stale = false, busy = false, plan = null, analysis, freshnessTimer;
  let quickTargets = [], quickIndex = -1;
  let dragController, automaticPlan = null, manuallyPlaced = false;
  const selected = new Set(), rows = new Map(), groupControls = [];
  const sourcePrompts = new Map((source?.prompts || []).map(prompt => [prompt.identifier, prompt]));
  const modal = node('dialog', 'pcm-modal pcm-migration-modal');
  const title = node('h2', 'pcm-migration-title', '一键迁移');
  title.id = `pcm-migration-title-${sequence}`; modal.setAttribute('aria-labelledby', title.id);
  const box = node('div', 'pcm-modal-box pcm-migration-box');
  const closeButton = button('关闭', 'close', close);
  const quickButton = button('快捷查看', 'quick', quickView); quickButton.hidden = true;
  const headingActions = node('div', 'pcm-migration-heading-actions'); headingActions.append(quickButton, closeButton);
  const heading = node('div', 'pcm-migration-heading'); heading.append(title, headingActions);
  const direction = node('p', 'pcm-migration-direction', `${sourceName || '旧版预设'} → ${targetName || '新版预设'}`);
  const header = node('header', 'pcm-migration-header'); header.append(heading, direction);
  const toolbar = node('div', 'pcm-migration-toolbar');
  const positionNote = node('p', 'pcm-migration-position-note'); positionNote.hidden = true; positionNote.setAttribute('role','status');
  const count = node('span', 'pcm-migration-count'); count.setAttribute('role', 'status');
  toolbar.append(button('全选', 'select-all', () => selectAll(true)), button('清空', 'clear', () => selectAll(false)), count);
  const issues = node('div', 'pcm-migration-issues'); issues.setAttribute('role', 'status'); issues.setAttribute('aria-live', 'polite');
  const errorBox = node('div', 'pcm-migration-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
  const list = node('div', 'pcm-migration-list');
  const preview = node('section', 'pcm-migration-preview'); preview.hidden = true; preview.setAttribute('aria-label', '迁移后完整顺序');
  const actions = node('div', 'pcm-migration-actions');
  const resetButton = button('恢复自动位置', 'reset-position', () => { if(!current() || !automaticPlan)return;plan=automaticPlan;manuallyPlaced=false;showPreview(true); }); resetButton.hidden = true;
  const previewButton = button('预览', 'preview', showPreview);
  const backButton = button('返回选择', 'preview-back', () => { selectionView(); previewButton.focus({ preventScroll: true }); }); backButton.hidden = true;
  const applyButton = button('一键迁移', 'apply', apply); applyButton.classList.add('pcm-primary');
  actions.append(resetButton, backButton, previewButton, applyButton);
  box.append(header, toolbar, positionNote, errorBox, issues, list, preview, actions); modal.append(box); parent.append(modal);
  dragController=installMigrationDrag({modal,box,header,footer:actions,preview,canDrag:()=>!busy&&!preview.hidden&&current(),onDrop:(id,placement)=>{
    try{plan=moveMigrationEntry(plan,id,placement);manuallyPlaced=true;showPreview(true);}catch(error){reportError(error.message);}
  }});

  function reportError(message) { errorBox.textContent = message; errorBox.hidden = !message; }
  function selectionView() {
    dragController?.cancel(); resetButton.hidden = true;
    positionNote.hidden = !manuallyPlaced;
    if(manuallyPlaced)positionNote.textContent = '已保留手动位置；更改勾选会重新自动定位。';
    list.hidden = false; toolbar.hidden = false; preview.hidden = true;
    previewButton.hidden = false; backButton.hidden = true;
    quickButton.hidden = true; quickTargets = []; quickIndex = -1;
  }
  function quickView() {
    if (!current() || preview.hidden || !quickTargets.length) return;
    quickTargets[quickIndex]?.row.classList.remove('is-quick-current');
    quickIndex = (quickIndex + 1) % quickTargets.length;
    const { row, body, toggle } = quickTargets[quickIndex];
    if (body.hidden) toggle.click();
    row.classList.add('is-quick-current');
    quickButton.textContent = `快捷查看${quickIndex + 1}/${quickTargets.length}`;
    quickButton.title = `已定位第 ${quickIndex + 1} 条；再次点击查看第 ${(quickIndex + 1) % quickTargets.length + 1} 条`;
    // 仅滚动本窗口，避开固定顶栏；保留按钮焦点以便连续键盘/触屏操作。
    box.scrollTop += row.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 8;
  }
  function current() {
    if (disposed) return false;
    if (!stale) {
      try { stale = typeof isCurrent === 'function' && !isCurrent(); }
      catch { stale = true; }
    }
    if (stale) {
      selectionView(); reportError('两侧预设、表单草稿或比较选项已变化，请关闭后重新打开迁移窗口。');
      applyButton.disabled = true; previewButton.disabled = true;
    }
    return !stale;
  }
  function close() {
    if (disposed) return;
    disposed = true; clearInterval(freshnessTimer);
    dragController?.destroy();
    parent.removeEventListener('close', parentClosed);
    if (modal.open) modal.close(); modal.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    onClose?.();
  }
  function parentClosed(event) { if (event.target === parent) close(); }
  function setSelected(ids, value) {
    let changed = false;
    for (const id of ids) {
      if (selected.has(id) !== value) changed = true;
      if (value) selected.add(id); else selected.delete(id);
      rows.get(id).checkbox.checked = value;
    }
    if (changed) recalculate();
  }
  function selectAll(value) { setSelected((analysis?.candidates || []).map(candidate => candidate.id), value); }
  function recalculate() {
    const resetManual = manuallyPlaced;
    manuallyPlaced = false;
    selectionView(); preview.replaceChildren(); reportError('');
    count.textContent = `已选 ${selected.size} / ${analysis?.candidates?.length || 0} 条`;
    for (const group of groupControls) {
      const n = group.ids.filter(id => selected.has(id)).length;
      group.control.checked = n === group.ids.length; group.control.indeterminate = n > 0 && n < group.ids.length;
    }
    plan = null;
    try { if (analysis) plan = planMigration(source, target, [...selected], { ignoreWhitespace }); }
    catch (error) { reportError(error?.message || '无法规划迁移，请重新打开。'); }
    automaticPlan = plan;
    issues.replaceChildren();
    const errors = [...new Set([...(analysis?.errors || []), ...(plan?.errors || [])])];
    for (const message of errors) issues.append(node('p', 'pcm-migration-problem', String(message)));
    issues.hidden = !errors.length;
    for (const [id, row] of rows) row.element.classList.toggle('is-selected', selected.has(id));
    applyButton.disabled = busy || !selected.size || !plan?.result || errors.length > 0;
    previewButton.disabled = !selected.size || !plan?.result || errors.length > 0;
    current();
    if(resetManual&&!stale){positionNote.textContent='选择已变化，位置已重新自动规划。';positionNote.hidden=false;}
  }
  function showPreview(preserve = false) {
    if (!current() || !plan?.result || previewButton.disabled) return;
    // Click handlers pass a MouseEvent; only an explicit true requests a post-drag redraw.
    preserve = preserve === true;
    dragController?.cancel(); reportError('');
    const scrollTop = box.scrollTop;
    const expanded = new Set([...preview.querySelectorAll('[data-migration-preview-expand][aria-expanded=true]')].map(e=>e.dataset.migrationPreviewExpand));
    const folded = new Set([...preview.querySelectorAll('[data-migration-preview-group-toggle][aria-expanded=false]')].map(e=>e.dataset.migrationPreviewBlock));
    preview.replaceChildren(); quickTargets = []; quickIndex = -1;
    const pane = node('div', 'pcm-pane pcm-migration-preview-pane');
    const ordered = node('div', 'pcm-list pcm-migration-preview-order'); pane.append(ordered); preview.append(pane);
    const resultPrompts = new Map(plan.result.prompts.map(prompt => [prompt.identifier, prompt]));
    const displayPrompts = new Map((targetPreview?.prompts || []).map(prompt => [prompt.identifier, prompt]));
    const resultRows = orderRows(plan.result), displayRows = orderRows(targetPreview);
    const meta = plan.result.extensions?.baibaiToolkit?.presetPromptGroups;
    const groups = new Map((meta?.groups || []).map(group => [group.id, group]));
    const blocks = [];
    for (const entry of plan.previewOrder || []) {
      const membership = meta?.prompts && Object.hasOwn(meta.prompts, entry.id) ? meta.prompts[entry.id] : null;
      const group = groups.get(membership?.groupId), groupId = group?.id || '', injected = entry.injected !== false;
      let block = blocks.at(-1);
      if (!block || block.groupId !== groupId || block.injected !== injected) { block = { groupId, group, injected, entries: [] }; blocks.push(block); }
      block.entries.push(entry);
    }
    for (const block of blocks) {
      const section = node('section', `pcm-group${block.group ? '' : ' pcm-ungrouped'}${block.injected ? '' : ' pcm-uninjected'}${block.group?.enabled === false ? ' pcm-group-power-off' : ''}`);
      section.dataset.migrationPreviewGroup = block.groupId;
      const head = node('header', 'pcm-group-head'), body = node('div', 'pcm-group-body');
      const groupName = block.group?.name || '未分组';
      const toggle = button('', 'preview-group-toggle', () => {}, 'pcm-group-toggle'); toggle.dataset.migrationPreviewGroupToggle = block.groupId;
      toggle.dataset.migrationPreviewBlock = JSON.stringify([block.groupId,block.injected,block.entries.find(entry=>!entry.incoming)?.id || block.entries.map(entry=>entry.id).sort()[0]]);
      const caret = node('span', 'pcm-group-caret'); caret.setAttribute('aria-hidden', 'true');
      toggle.append(caret, node('span', 'pcm-group-title', block.injected ? groupName : `${groupName} · 未注入`), node('small', '', `${block.entries.length} 条`));
      disclosure(toggle, body, caret); head.append(toggle);
      if (block.group) { const groupActions = node('span', 'pcm-group-actions'); groupActions.append(readonlySwitch(block.group.enabled !== false, groupName, 'preview-group-enabled', block.groupId, true)); head.append(groupActions); }
      section.append(head, body); ordered.append(section);
      for (const entry of block.entries) {
        const prompt = (!entry.incoming && displayPrompts.get(entry.id)) || resultPrompts.get(entry.id);
        const enabled = enabledOf(prompt, entry.incoming ? resultRows : displayRows);
        const row = node('article', `pcm-row pcm-migration-preview-row${enabled ? '' : ' pcm-row-disabled'}${entry.incoming ? ' is-incoming' : ''}`); row.dataset.migrationPreviewPrompt = entry.id;
        const open = button('', 'preview-expand', () => {}, 'pcm-open'); open.dataset.migrationPreviewExpand = entry.id;
        open.append(node('span', 'pcm-name', nameOf(prompt)));
        const switchControl = readonlySwitch(enabled, nameOf(prompt), 'preview-enabled', entry.id);
        row.append(open, switchControl);
        if (entry.incoming) {open.title='拖动调整位置；手机长按拖动，点击查看正文';row.append(node('span', 'pcm-badge pcm-added', '本次迁入'));}
        else row.append(node('span', 'pcm-migration-preview-spacer'));
        promptDisclosure(open, row, prompt, 'preview-body'); body.append(row);
        if (entry.incoming) quickTargets.push({ row, body, toggle });
      }
    }
    list.hidden = true; toolbar.hidden = true; preview.hidden = false;
    positionNote.hidden = true;
    previewButton.hidden = true; backButton.hidden = false;
    resetButton.hidden = !manuallyPlaced;
    quickButton.hidden = !quickTargets.length;
    quickButton.textContent = `快捷查看1/${quickTargets.length}`;
    quickButton.title = '点击查看第 1 条迁入条目；再次点击依次查看，末尾回到第 1 条';
    for(const control of preview.querySelectorAll('[data-migration-preview-expand]'))if(expanded.has(control.dataset.migrationPreviewExpand))control.click();
    for(const control of preview.querySelectorAll('[data-migration-preview-group-toggle]'))if(folded.has(control.dataset.migrationPreviewBlock))control.click();
    box.scrollTop = preserve ? scrollTop : 0; backButton.focus({ preventScroll: true });
  }
  function apply() {
    if (busy || !current() || applyButton.disabled || !plan?.result) return;
    busy = true; applyButton.disabled = true;
    try {
      if (onApply?.(plan) === true) { close(); return; }
      reportError('未完成迁移，请核对提示后重试。');
    } catch (error) { reportError(error?.message || '迁移失败，未关闭当前窗口。'); }
    finally { busy = false; if (!disposed) { applyButton.disabled = !selected.size || !plan?.result || !!plan?.errors?.length || !!analysis?.errors?.length; current(); } }
  }
  try { analysis = analyzeMigration(source, target, { ignoreWhitespace }); }
  catch (error) { analysis = { candidates: [], errors: [error?.message || '分析失败，请重新打开。'] }; }
  const groups = new Map();
  for (const candidate of analysis.candidates || []) {
    const key = candidate.sourceGroup?.id || '';
    if (!groups.has(key)) groups.set(key, { id: key, name: candidate.sourceGroup?.name || '未分组', candidates: [] });
    groups.get(key).candidates.push(candidate);
  }
  for (const group of groups.values()) {
    const section = node('section', 'pcm-migration-group'); section.dataset.migrationCandidateGroup = group.id;
    const head = node('header', 'pcm-migration-group-head'), body = node('div', 'pcm-migration-group-body');
    const groupCheck = checkbox(`选择分组“${group.name}”全部条目`, 'group-select', group.id);
    const toggle = button('', 'group-toggle', () => {}, 'pcm-migration-group-toggle'); toggle.dataset.migrationGroupToggle = group.id;
    const caret = node('span', 'pcm-migration-caret'); caret.setAttribute('aria-hidden', 'true');
    toggle.append(caret, node('span', '', group.name), node('small', '', `${group.candidates.length} 条`)); disclosure(toggle, body, caret);
    const ids = group.candidates.map(candidate => candidate.id); groupControls.push({ control: groupCheck, ids });
    groupCheck.addEventListener('change', () => setSelected(ids, groupCheck.checked));
    head.append(groupCheck, toggle); section.append(head, body);
    for (const candidate of group.candidates) {
      const row = node('article', 'pcm-migration-candidate'); row.dataset.migrationCandidate = candidate.id;
      const check = checkbox(`选择“${candidate.name}”`, 'select', candidate.id);
      check.checked = candidate.defaultSelected; if (check.checked) selected.add(candidate.id);
      check.addEventListener('change', () => setSelected([candidate.id], check.checked));
      const header = node('div', 'pcm-migration-candidate-head');
      const open = button(candidate.name, 'expand', () => {}, 'pcm-migration-name'); open.dataset.migrationExpand = candidate.id;
      header.append(check, open); row.append(header);
      promptDisclosure(open, row, sourcePrompts.get(candidate.id), 'body'); body.append(row);
      rows.set(candidate.id, { element: row, checkbox: check });
    }
    list.append(section);
  }
  if (!analysis.candidates?.length) list.append(node('p', 'pcm-migration-note', '没有可迁移的已注入条目。'));
  // Editor delegation is deliberately isolated: preview rows have no editing or drag data attributes.
  for (const eventName of ['click', 'change', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'dragstart', 'dragover', 'drop']) modal.addEventListener(eventName, event => event.stopPropagation());
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    else if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button,input,[tabindex="0"]')].filter(element => !element.disabled && element.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  modal.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); close(); });
  modal.addEventListener('close', close); parent.addEventListener('close', parentClosed);
  recalculate();
  if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
  closeButton.focus({ preventScroll: true }); modal.addEventListener('focusin', current);
  // Large preset snapshots are checked on interaction and before apply, not on idle ticks.
  freshnessTimer = setInterval(() => { if (!parent.isConnected) close(); }, 1000);
  return { close };
}
