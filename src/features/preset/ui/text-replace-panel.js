// 预设查找替换面板：按默认折叠的分组即时筛选条目、局部跨页选择，并在独立窗口对比替换前后，仅确认后通过回调更新草稿。
import {findLiteralRanges} from '../text-replace.js';
import {buildReplacementComparison, buildReplacementView, createEntryReplacementPreview} from './text-replace-view.js';

const PAGE_SIZE = 50;
let panelSequence = 0;

function node(tag, className = '', text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text, attribute, action) {
  const element = node('button', 'menu_button pcm-replace-button', text);
  element.type = 'button';
  element.setAttribute(attribute, '');
  element.addEventListener('click', action);
  return element;
}
function checkbox(label, attribute, checked) {
  const control = node('input');
  control.type = 'checkbox';
  control.checked = checked;
  control.setAttribute(attribute, '');
  const element = node('label', 'pcm-replace-check');
  element.append(control, document.createTextNode(label));
  return {element, control};
}
function appendSegments(element, segments, className) {
  for (const segment of segments) element.append(segment.hit ? node('mark', className, segment.text) : document.createTextNode(segment.text));
}
function sameVersion(a, b) {
  return !!a && !!b && ['preset', 'name', 'source', 'signature'].every(key => a[key] === b[key]);
}
function highlight(element, text, query, enabled, caseSensitive) {
  text = typeof text === 'string' ? text : '';
  if (!query || !enabled) { element.textContent = text; return; }
  let from = 0;
  for (const [start, end] of findLiteralRanges(text, query, {caseSensitive})) {
    element.append(document.createTextNode(text.slice(from, start)), node('mark', 'pcm-search-hit pcm-replace-highlight', text.slice(start, end)));
    from = end;
  }
  element.append(document.createTextNode(text.slice(from)));
}

/** Context versions protect previews; selection stays local and refresh never imports later editor selections. */
export function createTextReplacePanel({title = '', initialQuery = '', initialScope = 'selected', initialSelectedIds, getContext, onApply, onClose}) {
  let disposed = false, busy = false;
  let context = null, contextVersion = null, view = null, previewState = null, page = 0;
  let selectedIds = new Set(), expanded = new Set(), openGroups = new Set(), previewDialog = null, scope = initialScope === 'all' ? 'all' : 'selected';
  const sequence = ++panelSequence;
  const element = node('section', 'pcm-replace-panel');
  element.dataset.replacePanel = '';
  element.setAttribute('role', 'region');
  // 工具栏「替换」按钮本身即开关，面板不再重复显示标题和关闭按钮；Esc 仍可关闭。
  element.setAttribute('aria-label', '查找替换 · ' + title);
  const body = node('div', 'pcm-replace-body');
  element.append(body);

  const query = node('textarea');
  query.rows = 1;
  query.value = initialQuery;
  query.spellcheck = false;
  query.dataset.replaceQuery = '';
  query.setAttribute('aria-label', '查找文本');
  query.placeholder = '输入查找文本';
  const replacement = node('textarea');
  replacement.rows = 1;
  replacement.spellcheck = false;
  replacement.dataset.replaceReplacement = '';
  replacement.setAttribute('aria-label', '替换为');
  replacement.placeholder = '留空即删除';
  const textFields = node('div', 'pcm-replace-text-fields');
  for (const [label, control] of [['查找', query], ['替换为', replacement]]) {
    const field = node('label', 'pcm-replace-field');
    field.append(node('span', '', label), control);
    textFields.append(field);
  }
  const options = node('div', 'pcm-replace-options pcm-replace-strip');
  const contentOption = checkbox('条目正文', 'data-replace-content', true);
  const nameOption = checkbox('条目名称', 'data-replace-name', false);
  const caseOption = checkbox('区分大小写', 'data-replace-case', true);
  options.append(node('span', 'pcm-replace-strip-label', '查找范围：'), contentOption.element, nameOption.element, caseOption.element);
  const scopes = node('div', 'pcm-replace-scopes pcm-replace-strip');
  scopes.setAttribute('role', 'radiogroup');
  scopes.setAttribute('aria-label', '修改范围');
  scopes.append(node('span', 'pcm-replace-strip-label', '修改范围：'));
  const scopeInputs = [];
  for (const [value, label] of [['selected', '已选条目'], ['all', '所有条目']]) {
    const input = node('input');
    input.type = 'radio';
    input.name = 'pcm-replace-scope-' + sequence;
    input.value = value;
    input.checked = scope === value;
    input.dataset.replaceScope = '';
    const item = node('label', 'pcm-replace-scope');
    item.append(document.createTextNode(label), input);
    scopes.append(item);
    scopeInputs.push(input);
    input.addEventListener('change', () => {
      if (!input.checked || busy || disposed) return;
      scope = value;
      invalidate();
      renderResults();
    });
  }
  const status = node('p', 'pcm-replace-status');
  status.dataset.replaceStatus = '';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const results = node('div', 'pcm-replace-results');
  results.dataset.replaceResults = '';
  const footer = node('footer', 'pcm-replace-actions');
  const previewButton = button('预览替换', 'data-replace-preview', preview);
  const applyButton = button('确认替换', 'data-replace-apply', () => void apply());
  applyButton.classList.add('pcm-primary');
  applyButton.disabled = true;
  footer.append(previewButton, applyButton);
  body.append(textFields, options, scopes, status, results, footer);

  for (const control of [query, replacement, contentOption.control, nameOption.control, caseOption.control]) {
    control.addEventListener(control.tagName === 'TEXTAREA' ? 'input' : 'change', () => {
      if (busy || disposed) return;
      invalidate();
      if (control !== replacement) { page = 0; rebuildView(); }
      renderResults();
    });
  }
  element.addEventListener('keydown', event => {
    if (event.target.closest?.('[data-replace-preview-dialog]')) return;
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onClose?.(); }
  });

  function fields() {
    return [contentOption.control.checked && 'content', nameOption.control.checked && 'name'].filter(Boolean);
  }
  function searchOptions() { return {query: query.value, fields: fields(), caseSensitive: caseOption.control.checked}; }
  function report(message = '', error = false) {
    status.textContent = message;
    status.classList.toggle('pcm-replace-error', error);
  }
  function invalidate(message) {
    const hadPreview = !!previewState;
    previewState = null;
    closePreviewDialog();
    applyButton.disabled = true;
    report(message ?? (hadPreview ? '条件或选择已变更，请重新预览。' : ''));
  }
  function rebuildView() {
    view = buildReplacementView(context || {}, searchOptions());
    page = Math.min(page, Math.max(0, Math.ceil(view.candidates.length / PAGE_SIZE) - 1));
  }
  function effectiveSelection() {
    return scope === 'all' ? new Set(view.candidates.filter(item => item.selectable).map(item => item.id)) : new Set(selectedIds);
  }
  function syncScopeControls() { for (const control of scopeInputs) control.checked = control.value === scope; }
  function changeSelection(action, focusAttribute, focusValue) {
    if (disposed || busy) return;
    if (scope === 'all') { selectedIds = effectiveSelection(); scope = 'selected'; syncScopeControls(); }
    action(selectedIds);
    invalidate();
    renderResults({attribute: focusAttribute, value: focusValue});
  }
  function updateButtons() {
    previewButton.disabled = busy || !context;
    applyButton.disabled = busy || !previewState?.plan.matches.length;
  }
  function renderResults(focus) {
    if (!view) return;
    const selected = effectiveSelection(), first = page * PAGE_SIZE;
    const visible = view.candidates.slice(first, first + PAGE_SIZE), visibleKeys = new Set(visible.map(item => item.key));
    const preset = node('section', 'pcm-replace-preset');
    const presetHeader = node('div', 'pcm-replace-preset-head');
    presetHeader.append(node('h4', '', context?.presetName || title || '当前预设'));
    const count = node('span', 'pcm-replace-count');
    count.dataset.replaceCount = '';
    count.textContent = (query.value ? '匹配 ' : '共 ') + view.candidates.length + ' 条 · 已选 ' + selected.size + ' 条';
    presetHeader.append(count);
    preset.append(presetHeader);
    if (!view.entries.length) {
      preset.append(node('p', 'pcm-replace-empty', '当前预设没有可查找的条目。'));
    } else if (!view.candidates.length) {
      preset.append(node('p', 'pcm-replace-empty', fields().length ? '没有匹配的条目，请调整查找文本或查找范围。' : '请至少勾选条目正文或条目名称。'));
    }
    for (const group of view.groups) {
      const members = group.entries.filter(item => visibleKeys.has(item.key));
      if (!members.length) continue;
      const section = node('section', 'pcm-replace-group');
      section.dataset.replaceGroup = group.id;
      const collapsed = !openGroups.has(group.id);
      section.classList.toggle('is-collapsed', collapsed);
      const groupHeader = node('div', 'pcm-replace-group-head');
      const toggle = button('', 'data-replace-group-toggle', () => {
        if (busy) return;
        if (openGroups.has(group.id)) openGroups.delete(group.id); else openGroups.add(group.id);
        renderResults({attribute: 'data-replace-group-toggle', value: group.id});
      });
      toggle.classList.add('pcm-replace-group-toggle');
      toggle.dataset.replaceGroupToggle = group.id;
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', (collapsed ? '展开分组：' : '折叠分组：') + group.name);
      toggle.disabled = busy;
      const chevron = node('span', 'pcm-replace-chevron', '▸');
      chevron.setAttribute('aria-hidden', 'true');
      const groupSelected = group.ids.filter(id => selected.has(id)).length;
      toggle.append(chevron, node('h5', '', group.name), node('span', 'pcm-replace-group-count', members.length + ' 条' + (groupSelected ? ' · 已选 ' + groupSelected : '')));
      groupHeader.append(toggle);
      const allSelected = group.ids.length > 0 && group.ids.every(id => selected.has(id));
      const selectGroup = button(allSelected ? '取消此分组' : '全选此分组', 'data-replace-group-select', () => {
        changeSelection(selection => {
          const all = group.ids.every(id => selection.has(id));
          for (const id of group.ids) { if (all) selection.delete(id); else selection.add(id); }
        }, 'data-replace-group-select', group.id);
      });
      selectGroup.dataset.replaceGroupSelect = group.id;
      selectGroup.setAttribute('aria-pressed', String(allSelected));
      selectGroup.setAttribute('aria-label', (allSelected ? '取消选择分组：' : '选择整个分组：') + group.name);
      selectGroup.title = '包含该分组被查找隐藏及其他页的全部条目';
      selectGroup.disabled = busy || group.ids.length === 0;
      groupHeader.append(selectGroup);
      section.append(groupHeader);
      if (!collapsed) for (const item of members) section.append(entryRow(item, selected.has(item.id)));
      preset.append(section);
    }
    if (view.invalidCount) preset.append(node('p', 'pcm-replace-note', view.invalidCount + ' 个条目的 ID 缺失或重复，不能单独选择；如参与全部替换，将拒绝不明确的修改。'));
    const children = [preset];
    if (view.candidates.length > PAGE_SIZE) {
      const paging = node('div', 'pcm-replace-paging');
      const previous = button('上一页', 'data-replace-previous', () => { if (!busy && page > 0) { page--; renderResults(); } });
      const next = button('下一页', 'data-replace-next', () => { if (!busy && first + PAGE_SIZE < view.candidates.length) { page++; renderResults(); } });
      previous.disabled = busy || page === 0;
      next.disabled = busy || first + PAGE_SIZE >= view.candidates.length;
      const pageText = node('span', '', '第 ' + (page + 1) + '/' + Math.ceil(view.candidates.length / PAGE_SIZE) + ' 页 · ' + (first + 1) + '–' + (first + visible.length) + ' 条');
      pageText.dataset.replacePage = '';
      paging.append(previous, pageText, next);
      children.push(paging);
    }
    results.replaceChildren(...children);
    updateButtons();
    if (focus) [...results.querySelectorAll('[' + focus.attribute + ']')].find(item => item.getAttribute(focus.attribute) === focus.value)?.focus();
  }
  function entryRow(item, selected) {
    const {entry, id, key, selectable} = item;
    const isOpen = expanded.has(key), label = entry?.name || '未命名条目';
    const row = node('article', 'pcm-replace-entry');
    row.dataset.replaceEntry = id;
    row.classList.toggle('is-selected', selected && selectable);
    row.classList.toggle('is-open', isOpen);
    const toolbar = node('div', 'pcm-replace-entry-head');
    // 勾选框只负责选择；点击条目其余位置展开／收起正文，两者互不干扰。
    const choice = button('', 'data-replace-select', () => {
      if (selectable) changeSelection(selection => { if (selection.has(id)) selection.delete(id); else selection.add(id); }, 'data-replace-select', id);
    });
    choice.classList.add('pcm-replace-entry-select');
    choice.dataset.replaceSelect = id;
    choice.setAttribute('aria-pressed', String(selected && selectable));
    choice.setAttribute('aria-label', (selected && selectable ? '取消选择：' : '选择：') + label);
    choice.title = selectable ? (selected ? '取消选择' : '选择此条目') : '条目 ID 缺失或重复，不能单独选择';
    choice.disabled = busy || !selectable;
    const selectionMark = node('span', 'pcm-replace-selection-mark', selected && selectable ? '✓' : '');
    selectionMark.setAttribute('aria-hidden', 'true');
    choice.append(selectionMark);
    const expand = button('', 'data-replace-expand', () => {
      if (busy) return;
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      renderResults({attribute: 'data-replace-expand', value: id});
    });
    expand.classList.add('pcm-replace-entry-toggle');
    expand.dataset.replaceExpand = id;
    expand.setAttribute('aria-expanded', String(isOpen));
    expand.setAttribute('aria-controls', 'pcm-replace-entry-body-' + sequence + '-' + key);
    expand.title = isOpen ? '收起正文' : '展开正文';
    expand.disabled = busy;
    const name = node('span', 'pcm-replace-entry-name');
    highlight(name, label, query.value, nameOption.control.checked, caseOption.control.checked);
    expand.append(name);
    toolbar.append(choice, expand);
    row.append(toolbar);
    if (isOpen) {
      const detail = node('div', 'pcm-replace-entry-body');
      detail.id = 'pcm-replace-entry-body-' + sequence + '-' + key;
      detail.dataset.replaceBody = id;
      const pre = node('pre', 'pcm-replace-text');
      pre.dataset.replaceOriginal = id;
      highlight(pre, entry?.content, query.value, contentOption.control.checked, caseOption.control.checked);
      detail.append(pre);
      if (!pre.textContent) detail.append(node('span', 'pcm-replace-note', '（空正文）'));
      row.append(detail);
    }
    return row;
  }
  function closePreviewDialog() {
    const dialog = previewDialog;
    previewDialog = null;
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    dialog.remove();
  }
  function openPreviewDialog() {
    closePreviewDialog();
    if (!previewState?.plan.matches.length) return;
    const comparison = buildReplacementComparison(previewState.plan, previewState.afterById, view?.entries.map(item => item.id) || []);
    const dialog = node('dialog', 'pcm-replace-preview-dialog');
    dialog.dataset.replacePreviewDialog = '';
    dialog.setAttribute('aria-label', '替换预览');
    const head = node('header', 'pcm-replace-preview-head');
    const titleBox = node('div', 'pcm-replace-preview-title');
    titleBox.append(node('h3', '', '替换预览'), node('span', 'pcm-replace-preview-summary', previewState.plan.entryCount + ' 个条目 · ' + previewState.plan.matches.length + ' 处修改'));
    const closeButton = button('×', 'data-replace-preview-close', () => closePreviewDialog());
    closeButton.classList.add('pcm-replace-preview-x');
    closeButton.title = '关闭预览';
    closeButton.setAttribute('aria-label', '关闭预览');
    head.append(titleBox, closeButton);
    const list = node('div', 'pcm-replace-preview-list');
    for (const entry of comparison) {
      const article = node('article', 'pcm-replace-preview-entry');
      article.dataset.replacePreviewEntry = entry.id;
      const entryHead = node('div', 'pcm-replace-preview-entry-head');
      entryHead.append(node('h4', '', entry.originalName ?? entry.name ?? '未命名条目'), node('span', 'pcm-replace-preview-summary', entry.count + ' 处'));
      article.append(entryHead);
      for (const field of entry.fields) {
        if (entry.fields.length > 1 || field.field === 'name') article.append(node('span', 'pcm-replace-preview-field', field.field === 'name' ? '条目名称' : '条目正文'));
        const columns = node('div', 'pcm-replace-preview-columns');
        for (const [label, segments, className, attribute] of [['替换前', field.before, 'pcm-search-hit', 'replaceBefore'], ['替换后', field.after, 'pcm-replace-inserted', 'replaceAfter']]) {
          const column = node('div', 'pcm-replace-preview-column');
          const pre = node('pre', 'pcm-replace-text');
          pre.dataset[attribute] = entry.id;
          appendSegments(pre, segments, className);
          column.append(node('span', 'pcm-replace-preview-label', label), pre);
          if (!pre.textContent) column.append(node('span', 'pcm-replace-note', '（空）'));
          columns.append(column);
        }
        article.append(columns);
      }
      list.append(article);
    }
    const foot = node('footer', 'pcm-replace-actions');
    const back = button('返回修改', 'data-replace-preview-back', () => closePreviewDialog());
    const confirm = button('确认替换', 'data-replace-preview-apply', () => { closePreviewDialog(); void apply(); });
    confirm.classList.add('pcm-primary');
    foot.append(back, confirm);
    dialog.append(head, list, foot);
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closePreviewDialog();
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); closePreviewDialog(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) closePreviewDialog(); });
    element.append(dialog);
    previewDialog = dialog;
    if (typeof dialog.showModal === 'function') { try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); } }
    else dialog.setAttribute('open', '');
    confirm.focus();
  }
  function refresh() {
    if (disposed) return false;
    if (busy) return false;
    try {
      const latest = getContext();
      if (context && sameVersion(contextVersion, latest.version)) return false;
      const changed = !!context, hadPreview = !!previewState;
      context = latest;
      contextVersion = latest.version ? {...latest.version} : null;
      previewState = null;
      closePreviewDialog();
      rebuildView();
      const valid = new Set(view.entries.filter(item => item.selectable).map(item => item.id));
      selectedIds = new Set([...selectedIds].filter(id => valid.has(id)));
      const keys = new Set(view.entries.map(item => item.key));
      expanded = new Set([...expanded].filter(key => keys.has(key)));
      renderResults();
      if (changed) report(hadPreview ? '预设内容或表单已变化，原预览已失效，请重新预览。' : '列表已更新，查找条件和已有选择已保留。');
      return true;
    } catch (error) {
      context = contextVersion = null;
      invalidate();
      rebuildView();
      renderResults();
      report(error.message || String(error), true);
      return false;
    }
  }
  function preview() {
    if (busy || disposed) return;
    refresh();
    invalidate();
    try {
      if (!context) throw new Error('无法读取预设，请关闭后重新打开。');
      const options = {...searchOptions(), replacement: replacement.value};
      if (!options.fields.length) throw new Error('请至少勾选条目正文或条目名称。');
      if (!options.query.length) throw new Error('请输入查找文本；空格和换行也可以作为查找内容。');
      rebuildView();
      const targets = view.entries.filter(item => scope === 'all' || selectedIds.has(item.id)).map(item => item.entry);
      if (!targets.length) throw new Error('请先选择要修改的条目，或切换到所有条目。');
      const next = createEntryReplacementPreview(targets, options);
      previewState = {...next, context: {...context, version: contextVersion && {...contextVersion}, replaceScope: scope, replaceIds: targets.map(entry => entry.identifier)}};
      renderResults();
      report(next.plan.matches.length ? '已在预览窗口显示 ' + next.plan.entryCount + ' 个条目、' + next.plan.matches.length + ' 处修改；核对后点击“确认替换”。' : '没有需要替换的匹配；替换前后相同的内容会自动跳过。');
      if (next.plan.matches.length) openPreviewDialog();
    } catch (error) {
      previewState = null;
      renderResults();
      report(error.message || String(error), true);
    }
  }
  async function apply() {
    if (busy || disposed || !previewState?.plan.matches.length) return;
    // Re-read immediately before committing, even when a parent refresh has not run yet.
    refresh();
    if (!previewState?.plan.matches.length) return;
    const currentPreview = previewState, keys = currentPreview.plan.matches.map(match => match.key);
    busy = true;
    const priorDisabled = new Map();
    for (const control of element.querySelectorAll('input,textarea,button')) { priorDisabled.set(control, control.disabled); control.disabled = true; }
    report('正在校验并更新草稿…');
    let message, failed = false;
    try {
      const result = await onApply(currentPreview.plan, keys, currentPreview.context);
      if (result === false || result?.ok === false) throw new Error(result?.message || '未应用替换，请重新预览后再试。');
      message = '已更新 ' + (result?.entryCount ?? currentPreview.plan.entryCount) + ' 个条目、' + (result?.matchCount ?? keys.length) + ' 处草稿。可整批撤回，保存后生效。';
    } catch (error) {
      message = (error.message || String(error)) + ' 请重新预览。';
      failed = true;
    } finally {
      busy = false;
      if (!disposed) {
        for (const [control, disabled] of priorDisabled) control.disabled = disabled;
        previewState = null;
        // Apply may synchronously renderAll; defer its refresh until the transaction has returned.
        refresh();
        rebuildView();
        renderResults();
        report(message, failed);
      }
    }
  }
  try {
    context = getContext();
    contextVersion = context.version ? {...context.version} : null;
    selectedIds = new Set(Array.from(initialSelectedIds ?? context.selectedIds ?? [], String));
    rebuildView();
    const valid = new Set(view.entries.filter(item => item.selectable).map(item => item.id));
    selectedIds = new Set([...selectedIds].filter(id => valid.has(id)));
    renderResults();
  } catch (error) { report(error.message || String(error), true); }
  return {element, refresh, dispose() { disposed = true; previewState = null; closePreviewDialog(); element.remove(); }};
}
