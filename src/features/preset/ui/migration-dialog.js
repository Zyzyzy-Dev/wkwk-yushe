// 一键迁移窗口：折叠分组勾选、只读正文与编辑器样式预览，自动规划后一次应用到新版草稿。
import { analyzeMigration, planMigration } from '../migration.js';
import { findPromptOrderEntry } from '../core.js';

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
  const selected = new Set(), rows = new Map(), groupControls = [];
  const sourcePrompts = new Map((source?.prompts || []).map(prompt => [prompt.identifier, prompt]));
  const modal = node('dialog', 'pcm-modal pcm-migration-modal');
  const title = node('h2', 'pcm-migration-title', '一键迁移');
  title.id = `pcm-migration-title-${sequence}`; modal.setAttribute('aria-labelledby', title.id);
  const box = node('div', 'pcm-modal-box pcm-migration-box');
  const closeButton = button('关闭', 'close', close);
  const heading = node('div', 'pcm-migration-heading'); heading.append(title, closeButton);
  const direction = node('p', 'pcm-migration-direction', `${sourceName || '旧版预设'} → ${targetName || '新版预设'}`);
  const toolbar = node('div', 'pcm-migration-toolbar');
  const count = node('span', 'pcm-migration-count'); count.setAttribute('role', 'status');
  toolbar.append(button('全选', 'select-all', () => selectAll(true)), button('清空', 'clear', () => selectAll(false)), count);
  const issues = node('div', 'pcm-migration-issues'); issues.setAttribute('role', 'status'); issues.setAttribute('aria-live', 'polite');
  const errorBox = node('div', 'pcm-migration-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
  const list = node('div', 'pcm-migration-list');
  const preview = node('section', 'pcm-migration-preview'); preview.hidden = true; preview.setAttribute('aria-label', '迁移后完整顺序');
  const actions = node('div', 'pcm-migration-actions');
  const previewButton = button('预览', 'preview', showPreview);
  const backButton = button('返回选择', 'preview-back', () => { selectionView(); previewButton.focus({ preventScroll: true }); }); backButton.hidden = true;
  const applyButton = button('一键迁移', 'apply', apply); applyButton.classList.add('pcm-primary');
  actions.append(backButton, previewButton, applyButton);
  box.append(heading, direction, toolbar, errorBox, issues, list, preview, actions); modal.append(box); parent.append(modal);

  function reportError(message) { errorBox.textContent = message; errorBox.hidden = !message; }
  function selectionView() {
    list.hidden = false; toolbar.hidden = false; preview.hidden = true;
    previewButton.hidden = false; backButton.hidden = true;
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
    parent.removeEventListener('close', parentClosed);
    if (modal.open) modal.close(); modal.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    onClose?.();
  }
  function parentClosed(event) { if (event.target === parent) close(); }
  function setSelected(ids, value) {
    for (const id of ids) {
      if (value) selected.add(id); else selected.delete(id);
      rows.get(id).checkbox.checked = value;
    }
    recalculate();
  }
  function selectAll(value) { setSelected((analysis?.candidates || []).map(candidate => candidate.id), value); }
  function recalculate() {
    selectionView(); preview.replaceChildren(); reportError('');
    count.textContent = `已选 ${selected.size} / ${analysis?.candidates?.length || 0} 条`;
    for (const group of groupControls) {
      const n = group.ids.filter(id => selected.has(id)).length;
      group.control.checked = n === group.ids.length; group.control.indeterminate = n > 0 && n < group.ids.length;
    }
    plan = null;
    try { if (analysis) plan = planMigration(source, target, [...selected], { ignoreWhitespace }); }
    catch (error) { reportError(error?.message || '无法规划迁移，请重新打开。'); }
    issues.replaceChildren();
    const errors = [...new Set([...(analysis?.errors || []), ...(plan?.errors || [])])];
    for (const message of errors) issues.append(node('p', 'pcm-migration-problem', String(message)));
    issues.hidden = !errors.length;
    for (const [id, row] of rows) row.element.classList.toggle('is-selected', selected.has(id));
    applyButton.disabled = busy || !selected.size || !plan?.result || errors.length > 0;
    previewButton.disabled = !selected.size || !plan?.result || errors.length > 0;
    current();
  }
  function showPreview() {
    if (!current() || !plan?.result || previewButton.disabled) return;
    preview.replaceChildren();
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
        if (entry.incoming) row.append(node('span', 'pcm-badge pcm-added', '本次迁入'));
        else row.append(node('span', 'pcm-migration-preview-spacer'));
        promptDisclosure(open, row, prompt, 'preview-body'); body.append(row);
      }
    }
    list.hidden = true; toolbar.hidden = true; preview.hidden = false;
    previewButton.hidden = true; backButton.hidden = false;
    box.scrollTop = 0; backButton.focus({ preventScroll: true });
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
