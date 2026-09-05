// 世界书缝合面板：文件/宿主读取、条目筛选与正文预览，提交所选条目给应用草稿。
import { readWorldbook } from '../worldbook.js';
import { host } from './bridge.js';

const node = (tag, className = '', text) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
function button(text, run, className = '') {
  const element = node('button', `menu_button ${className}`, text);
  element.type = 'button';
  element.addEventListener('click', run);
  return element;
}
function option(select, value, text) {
  const element = node('option', '', text);
  element.value = value;
  select.append(element);
}

export function openWorldbookPanel({ dialog, title, onApply, onPick }) {
  dialog.querySelector('[data-worldbook-panel]')?.remove();
  const panel = node('section', 'pcm-picker open');
  panel.dataset.worldbookPanel = '';
  const box = node('div', 'pcm-picker-panel pcm-worldbook-panel');
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', '世界书缝合');
  const close = () => { panel.remove(); dialog.classList.remove('pcm-worldbook-open'); };
  const head = node('header', 'pcm-picker-head');
  const closeButton = button('×', close, 'pcm-close');
  closeButton.setAttribute('aria-label', '关闭世界书缝合');
  head.append(node('strong', '', `世界书缝合 · ${title}`), closeButton);
  const body = node('div', 'pcm-worldbook-body');
  const sources = node('div', 'pcm-worldbook-controls');
  const fileLabel = node('label', 'menu_button pcm-import', '导入世界书 JSON');
  const file = node('input');
  file.type = 'file'; file.multiple = true; file.accept = '.json,application/json';
  file.setAttribute('aria-label', '导入世界书 JSON');
  fileLabel.append(file);
  const bookSelect = node('select');
  bookSelect.setAttribute('aria-label', '酒馆世界书');
  bookSelect.hidden = true;
  option(bookSelect, '', '先读取酒馆世界书列表');
  const status = node('p', 'pcm-worldbook-status');
  status.setAttribute('role', 'status');
  const report = error => { status.textContent = error.message || String(error); status.classList.add('pcm-worldbook-error'); };
  const books = new Map();
  const selected = new Set();
  let items = [];
  let busy = false;
  let currentTavernName = '';
  const applyButtons = [];
  const keyOf = item => JSON.stringify([item.source, item.key]);
  function addBook(data, source, replaceTavern = false) {
    const entries = readWorldbook(data, source);
    if (!entries.length) throw new Error('这个世界书没有条目。');
    if (replaceTavern) for (const [name, previous] of books) {
      if (!name.startsWith('酒馆：')) continue;
      for (const entry of previous) selected.delete(keyOf(entry));
      books.delete(name);
    }
    for (const entry of books.get(source) || []) selected.delete(keyOf(entry));
    books.set(source, entries);
    for (const entry of entries) selected.add(keyOf(entry));
    items = [...books.values()].flat();
    status.classList.remove('pcm-worldbook-error');
    status.textContent = `已加载 ${books.size} 本世界书`;
    search.value = ''; filter.value = 'all';
    render();
  }
  async function runBusy(control, work) {
    if (busy) return;
    busy = true; applyButtons.forEach(button => { button.disabled = true; });
    for (const input of sources.querySelectorAll('button,input,select')) input.disabled = true;
    try { await work(); } catch (error) { if (panel.isConnected) report(error); }
    finally {
      busy = false;
      for (const input of sources.querySelectorAll('button,input,select')) input.disabled = false;
      updateCount();
    }
  }
  const loadBooks = button('酒馆世界书', () => runBusy(loadBooks, async () => {
    const names = await host.request('list-worldbooks');
    if (!panel.isConnected) return;
    bookSelect.replaceChildren(); option(bookSelect, '', names.length ? '选择世界书' : '酒馆中没有世界书');
    for (const name of names) option(bookSelect, name, name);
    bookSelect.hidden = false;
    bookSelect.value = names.includes(currentTavernName) ? currentTavernName : '';
    status.classList.remove('pcm-worldbook-error'); status.textContent = '';
  }));
  bookSelect.addEventListener('change', () => runBusy(bookSelect, async () => {
    if (!bookSelect.value) return;
    const name = bookSelect.value;
    status.classList.remove('pcm-worldbook-error'); status.textContent = '正在读取世界书…';
    try {
      const data = await host.request('read-worldbook', { name });
      if (!panel.isConnected) return;
      addBook(data, `酒馆：${name}`, true);
      currentTavernName = name;
    } catch (error) { bookSelect.value = currentTavernName; throw error; }
  }));
  sources.append(fileLabel, loadBooks, bookSelect);
  file.addEventListener('change', () => {
    const files = [...file.files]; file.value = '';
    runBusy(file, async () => {
      const errors = [];
      for (const item of files) {
        try {
          const data = JSON.parse(await item.text());
          if (!panel.isConnected) return;
          addBook(data, `文件：${item.name}`);
        } catch (error) { errors.push(`${item.name}：${error.message}`); }
      }
      if (errors.length) report(new Error(errors.join('\n')));
    });
  });
  const filters = node('div', 'pcm-worldbook-controls');
  const search = node('input'); search.type = 'search'; search.placeholder = '搜索条目名称、来源或正文';
  search.setAttribute('aria-label', '搜索世界书条目');
  const filter = node('select'); filter.setAttribute('aria-label', '世界书条目状态');
  option(filter, 'all', '全部状态'); option(filter, 'enabled', '仅启用'); option(filter, 'disabled', '仅禁用');
  filters.append(search, filter);
  const selection = node('div', 'pcm-worldbook-controls');
  const count = node('span', 'pcm-worldbook-count');
  const visibleItems = () => {
    const query = search.value.trim().toLocaleLowerCase();
    return items.filter(item => (!query || `${item.name}\n${item.source}\n${item.content}`.toLocaleLowerCase().includes(query))
      && (filter.value === 'all' || (filter.value === 'enabled') === item.enabled));
  };
  const selectedItems = () => items.filter(item => selected.has(keyOf(item)));
  function updateCount() {
    count.textContent = `已选 ${selected.size} / ${items.length} 条（筛选不清除选择）`;
    applyButtons.forEach(button => { button.disabled = busy || !selected.size; });
  }
  selection.append(button('全选筛选结果', () => { for (const item of visibleItems()) selected.add(keyOf(item)); render(); }),
    button('取消选择', () => { selected.clear(); render(); }),
    button('清空来源', () => { books.clear(); items = []; selected.clear(); currentTavernName = ''; bookSelect.value = ''; status.textContent = ''; render(); }), count);
  const list = node('div', 'pcm-worldbook-list');
  function render() {
    list.replaceChildren();
    const visible = visibleItems();
    if (!visible.length) list.append(node('p', '', items.length ? '没有符合筛选条件的条目' : '导入文件或选择酒馆世界书后，在这里选择条目。'));
    for (const item of visible) {
      const row = node('div', 'pcm-worldbook-entry');
      const check = node('input'); check.type = 'checkbox'; check.checked = selected.has(keyOf(item));
      check.setAttribute('aria-label', `选择 ${item.name}`);
      check.addEventListener('change', () => { if (check.checked) selected.add(keyOf(item)); else selected.delete(keyOf(item)); updateCount(); });
      const details = node('details');
      const summary = node('summary');
      summary.append(node('strong', '', item.name), node('small', '', `${item.enabled ? '启用' : '禁用'} · ${item.source} · ${item.content.length} 字符`));
      details.append(summary);
      details.addEventListener('toggle', () => {
        if (details.open && !details.querySelector('pre')) details.append(node('pre', '', item.content || '（空正文）'));
      });
      row.append(check, details); list.append(row);
    }
    updateCount();
  }
  search.addEventListener('input', render); filter.addEventListener('change', render);
  const footer = node('footer', 'pcm-worldbook-footer');
  const keepLabel = node('label', 'pcm-worldbook-check');
  const keep = node('input'); keep.type = 'checkbox'; keep.checked = true;
  keepLabel.append(keep, document.createTextNode('保留禁用状态'));
  const positions = node('div', 'pcm-worldbook-positions');
  for (const [label, placement] of [['注入预设最前', 'start'], ['注入预设末尾', 'end'], ['注入指定位置', 'pick']]) {
    const apply = button(label, () => {
      try {
        const entries = selectedItems(), options = { keepDisabled: keep.checked };
        if (placement === 'pick') {
          panel.classList.remove('open'); dialog.classList.remove('pcm-worldbook-open');
          onPick(entries, options, {
            done: close,
            restore() { if (panel.isConnected) { panel.classList.add('open'); dialog.classList.add('pcm-worldbook-open'); apply.focus(); } },
          });
        } else { onApply(entries, { ...options, placement }); close(); }
      } catch (error) { panel.classList.add('open'); dialog.classList.add('pcm-worldbook-open'); report(error); }
    }, 'pcm-primary');
    applyButtons.push(apply); positions.append(apply);
  }
  footer.append(keepLabel, positions);
  body.append(sources, status, filters, selection, list);
  box.append(head, body, footer); panel.append(box); dialog.append(panel);
  dialog.classList.add('pcm-worldbook-open');
  // 阻止面板操作落入预设主界面的委托路由；Esc 只关闭本浮层。
  panel.addEventListener('click', event => event.stopPropagation());
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  render(); closeButton.focus();
}
