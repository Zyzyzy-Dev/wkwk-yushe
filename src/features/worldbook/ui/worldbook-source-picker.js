// 世界书来源选择弹窗：名称检索、独立滚动、键盘关闭与异步读取失败提示。
export function openWorldbookSourcePicker({ parent, names, onChoose, onClose }) {
  const node = (tag, className = '', text) => {
    const element = document.createElement(tag); element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const picker = node('dialog', 'pcm-worldbook-source-picker');
  picker.setAttribute('aria-label', '选择酒馆世界书');
  const head = node('header', 'pcm-picker-head');
  const closeButton = node('button', 'menu_button pcm-close', '×');
  closeButton.type = 'button'; closeButton.setAttribute('aria-label', '关闭世界书选择');
  head.append(node('strong', '', '选择酒馆世界书'), closeButton);
  const search = node('input'); search.type = 'search'; search.placeholder = '搜索世界书名称';
  search.setAttribute('aria-label', '搜索世界书名称');
  const searchBar = node('div', 'pcm-worldbook-source-search'); searchBar.append(search);
  const status = node('p', 'pcm-worldbook-source-status'); status.setAttribute('role', 'status');
  const list = node('div', 'pcm-worldbook-source-list');
  let busy = false;
  function close() {
    if (!picker.isConnected) return;
    picker.close(); picker.remove(); onClose?.();
  }
  function render() {
    list.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    const shown = names.filter(name => name.toLocaleLowerCase().includes(query));
    for (const name of shown) {
      const choice = node('button', 'menu_button pcm-worldbook-source-choice', name);
      choice.type = 'button'; choice.title = name;
      choice.addEventListener('click', async () => {
        if (busy) return;
        busy = true; search.disabled = true;
        for (const item of list.querySelectorAll('button')) item.disabled = true;
        status.textContent = '正在读取世界书…';
        try {
          // 关闭弹窗后不应用在途读取结果。
          await onChoose(name, () => picker.isConnected);
          close();
        } catch (error) {
          if (picker.isConnected) status.textContent = error.message || String(error);
        } finally {
          busy = false; search.disabled = false;
          for (const item of list.querySelectorAll('button')) item.disabled = false;
        }
      });
      list.append(choice);
    }
    if (!shown.length) list.append(node('p', 'pcm-worldbook-source-empty', names.length ? '没有匹配的世界书' : '酒馆中没有世界书'));
  }
  search.addEventListener('input', render);
  closeButton.addEventListener('click', close);
  picker.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); close(); });
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  picker.addEventListener('click', event => event.stopPropagation());
  picker.append(head, searchBar, status, list); parent.append(picker);
  render(); picker.showModal(); search.focus();
  return { close };
}
