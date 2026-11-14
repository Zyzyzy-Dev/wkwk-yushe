// 临时库列表：只读正文预览、搜索及材料管理；插入由独立拖拽模块处理。
const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const button = (text, run) => { const b = node('button', 'menu_button', text); b.type = 'button'; b.addEventListener('click', run); return b; };

export function createTempLibraryPanel({ session, onAdd, onClose, confirm, onChange, isCompareMode = () => false, getSelectedId = () => null, onSelect = () => {} }) {
  const element = node('section', 'pcm-temp-library'); element.dataset.tempLibrary = ''; element.setAttribute('aria-label', '临时库');
  const head = node('header', 'pcm-temp-head'), title = node('strong', '', '临时库'), count = node('span', 'pcm-temp-count');
  head.append(title, count, button('收起', onClose));
  const actions = node('div', 'pcm-temp-actions'), search = node('input'); search.type = 'search'; search.placeholder = '搜索名称、来源或正文'; search.setAttribute('aria-label', '搜索临时库'); search.value = session.query;
  let alive = true, clearing = false;
  const clear = button('清空', async () => {
    if (clearing || !session.items.size) return;
    const baseline = [...session.items]; clearing = true; clear.disabled = true;
    try {
      if (!await confirm('清空临时库？已插入预设的条目不受影响。')) return;
      if (!alive || baseline.length !== session.items.size || baseline.some(([id, item]) => session.items.get(id) !== item)) return;
      session.items.clear(); session.expanded.clear(); refresh(); onChange();
    } finally { clearing = false; if (alive) clear.disabled = !session.items.size; }
  });
  actions.append(button('继续添加', onAdd), clear);
  const hint = node('p', 'pcm-temp-hint', '拖入后成为预设条目，不保留世界书触发条件。刷新酒馆后清空。');
  const list = node('div', 'pcm-temp-list'); list.dataset.tempList = '';
  element.append(head, actions, search, hint, list);
  function refresh() {
    const top = list.scrollTop; list.replaceChildren(); count.textContent = `${session.items.size} 条`; clear.disabled = clearing || !session.items.size;
    const query = session.query.trim().toLocaleLowerCase(); let shown = 0;
    for (const item of session.items.values()) {
      if (query && !`${item.name}\n${item.source}\n${item.content}`.toLocaleLowerCase().includes(query)) continue;
      shown++;
      const row = node('article', 'pcm-temp-entry'); row.dataset.tempEntry = item.id;
      const details = node('details'), summary = node('summary', 'pcm-temp-drag'); summary.dataset.tempDrag = ''; summary.title = '电脑按住拖拽；手机长按拖拽';
      const name = node('strong', 'pcm-temp-name', item.name); name.title = item.name;
      const remove = button('移除', event => { event.preventDefault(); event.stopPropagation(); session.items.delete(item.id); session.expanded.delete(item.id); refresh(); onChange(); }); remove.setAttribute('aria-label', `从临时库移除 ${item.name}`);
      const source = node('small', 'pcm-temp-source', item.source); source.title = item.source;
      summary.append(name, source, remove);
      summary.addEventListener('click', event => {
        if (!isCompareMode()) return;
        event.preventDefault(); event.stopPropagation(); onSelect(item.id); refreshSelection();
      });
      details.append(summary); details.open = session.expanded.has(item.id);
      const showContent = () => { if (details.open && !details.querySelector('pre')) details.append(node('pre', 'pcm-temp-content', item.content || '（空正文）')); };
      showContent(); details.addEventListener('toggle', () => { if (!row.isConnected) return; if (details.open) session.expanded.add(item.id); else session.expanded.delete(item.id); showContent(); });
      row.append(details); list.append(row);
    }
    if (!shown) list.append(node('p', 'pcm-temp-empty', session.items.size ? '没有符合搜索条件的条目' : '从世界书勾选条目后加入这里'));
    list.scrollTop = top; refreshSelection();
  }
  function refreshSelection() {
    const comparing = isCompareMode(), selectedId = getSelectedId();
    for (const row of list.querySelectorAll('[data-temp-entry]')) {
      const selected = comparing && row.dataset.tempEntry === selectedId;
      row.classList.toggle('pcm-temp-selected', selected);
      const summary = row.querySelector('[data-temp-drag]');
      summary.title = comparing ? '点击选择对比；电脑按住拖拽，手机长按拖拽' : '电脑按住拖拽；手机长按拖拽';
      if (selected) summary.setAttribute('aria-current', 'true'); else summary.removeAttribute('aria-current');
    }
  }
  search.addEventListener('input', () => { session.query = search.value; refresh(); });
  refresh();
  return { element, refresh, refreshSelection, destroy() { alive = false; element.remove(); } };
}
