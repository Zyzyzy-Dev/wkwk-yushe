// 世界书选点模式：在预设对比列表中选择条目及前后位置，维护返回、Esc 和监听清理。
export function beginWorldbookPlacement({ dialog, side, count, onApply, onCancel, getPrompt }) {
  const banner = document.createElement('section');
  banner.className = 'pcm-worldbook-placement';
  banner.setAttribute('aria-label', '世界书插入位置');
  const text = document.createElement('div');
  text.className = 'pcm-worldbook-placement-text';
  text.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'pcm-worldbook-placement-actions';
  const controller = new AbortController();
  let active = true, anchorId = null;
  const sideName = side === 'old' ? '旧版' : '新版';
  const list = dialog.querySelector(`[data-list="${side}"]`);
  const pane = list.closest('.pcm-pane');
  pane.classList.add('pcm-worldbook-target');
  const message = () => { text.textContent = `待注入 ${count} 条 · 请点击${sideName}预设中的目标条目`; };
  const button = (label, run) => {
    const element = document.createElement('button');
    element.type = 'button'; element.className = 'menu_button'; element.textContent = label;
    element.addEventListener('click', run);
    actions.append(element);
    return element;
  };
  const finish = () => {
    if (!active) return;
    active = false; controller.abort(); observer.disconnect(); sizeObserver.disconnect();
    pane.classList.remove('pcm-worldbook-target');
    pane.style.removeProperty('--pcm-placement-height');
    list.querySelectorAll('.pcm-worldbook-anchor').forEach(row => row.classList.remove('pcm-worldbook-anchor'));
    banner.remove();
  };
  const cancel = (restore = true) => { if (!active) return; finish(); if (restore) onCancel(); };
  const inject = after => {
    if (!anchorId) return;
    try { onApply(after ? { afterId: anchorId } : { beforeId: anchorId }); finish(); }
    catch (error) { text.textContent = error.message; }
  };
  const before = button('插入之前', () => inject(false));
  const after = button('插入之后', () => inject(true));
  before.disabled = after.disabled = true;
  button('返回世界书', () => cancel());
  const highlight = () => {
    for (const row of list.querySelectorAll('.pcm-row')) row.classList.toggle('pcm-worldbook-anchor', row.dataset.dragId === anchorId);
  };
  const clearAnchor = () => { anchorId = null; before.disabled = after.disabled = true; highlight(); };
  const observer = new MutationObserver(highlight);
  observer.observe(list, { childList: true, subtree: true });
  const sizeObserver = new ResizeObserver(() => pane.style.setProperty('--pcm-placement-height', `${banner.offsetHeight + 20}px`));
  sizeObserver.observe(banner);
  message(); banner.append(text, actions); dialog.append(banner);
  // 在 document 捕获，早于主面板自由选择、开关、多选和拖拽处理；滚动手势仍交给列表。
  document.addEventListener('click', event => {
    if (!active || !dialog.contains(event.target)) return;
    if (banner.contains(event.target)) return;
    if (event.target.closest('.pcm-picker.open,.pcm-modal')) return;
    const row = event.target.closest('.pcm-row');
    if (!row) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (row.dataset.dragSide !== side) { clearAnchor(); message(); return; }
    const id = row.dataset.dragId, prompt = getPrompt(id);
    if (!prompt) { clearAnchor(); text.textContent = '该条目尚未注入或已失效，请选择已注入的预设条目'; return; }
    anchorId = id;
    text.textContent = `将 ${count} 条插入「${prompt.name || '未命名条目'}」`;
    before.disabled = after.disabled = false;
    highlight();
  }, { capture: true, signal: controller.signal });
  for (const type of ['pointerdown', 'touchstart', 'dragstart']) document.addEventListener(type, event => {
    if (active && dialog.contains(event.target) && event.target.closest('.pcm-row') && !event.target.closest('.pcm-picker.open')) event.stopPropagation();
  }, { capture: true, passive: true, signal: controller.signal });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !active || dialog.querySelector('.pcm-picker.open,.pcm-modal[open]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); cancel();
  }, { capture: true, signal: controller.signal });
  return { cancel };
}
