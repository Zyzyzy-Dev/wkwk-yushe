// 移动端双列表布局：比例约束、长按拖动、持久化及监听生命周期。
export function paneHeights(total, ratio) {
  total = Math.max(320, Number.isFinite(total) ? Math.round(total) : 320);
  ratio = Number.isFinite(ratio) ? ratio : 0.5;
  const old = Math.max(160, Math.min(total - 160, Math.round(total * ratio)));
  return { old, new: total - old, total };
}

const STORAGE_KEY = 'preset-compare-migrator.pane-ratio';
export function installPaneLayout(dialog, onEnvironment) {
  const app = dialog.querySelector('.pcm-app');
  const header = app.querySelector('.pcm-header');
  const lists = app.querySelector('.pcm-lists');
  const panes = [...lists.querySelectorAll('.pcm-pane')];
  const grip = document.createElement('div');
  grip.className = 'pcm-pane-resizer';
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'horizontal');
  grip.setAttribute('aria-label', '调整新旧预设高度比例');
  grip.title = '长按后上下拖动调整比例；方向键微调，Home 恢复各半';
  panes.forEach((pane, i) => { pane.id = dialog.id + '-pane-' + (i ? 'new' : 'old'); });
  grip.setAttribute('aria-controls', panes.map(pane => pane.id).join(' '));
  panes[1].querySelector('.pcm-pane-head').insertBefore(grip, panes[1].querySelector('.pcm-actions'));
  const mobile = matchMedia('(max-width: 900px)');
  let ratio = 0.5, sizes = paneHeights(320, ratio), gesture = null, timer = 0, frame = 0;
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved > 0 && saved < 1) ratio = saved;
  } catch { /* 禁用存储时本次会话仍可拖动。 */ }
  const save = () => { try { localStorage.setItem(STORAGE_KEY, String(ratio)); } catch {} };
  function refresh() {
    if (!mobile.matches || !header.offsetHeight || app.classList.contains('pcm-view-hidden')) return;
    const appStyle = getComputedStyle(app), listStyle = getComputedStyle(lists);
    const room = dialog.clientHeight - header.offsetHeight - parseFloat(appStyle.paddingTop) - parseFloat(appStyle.paddingBottom)
      - parseFloat(listStyle.paddingTop) - parseFloat(listStyle.paddingBottom) - parseFloat(listStyle.rowGap);
    sizes = paneHeights(room, ratio);
    lists.style.setProperty('--pcm-old-pane-height', sizes.old + 'px');
    lists.style.setProperty('--pcm-new-pane-height', sizes.new + 'px');
    grip.setAttribute('aria-valuemin', String(Math.ceil(160 / sizes.total * 100)));
    grip.setAttribute('aria-valuemax', String(Math.floor((sizes.total - 160) / sizes.total * 100)));
    const percent = Math.round(sizes.old / sizes.total * 100);
    grip.setAttribute('aria-valuenow', String(percent));
    grip.setAttribute('aria-valuetext', `旧版 ${percent}%，新版 ${100 - percent}%`);
  }
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); };
  function finish(commit = false) {
    clearTimeout(timer);
    const previous = gesture;
    gesture = null;
    grip.classList.remove('pcm-resizer-holding');
    dialog.classList.remove('pcm-resizing-panes');
    if (!previous) return;
    if (grip.hasPointerCapture(previous.id)) grip.releasePointerCapture(previous.id);
    if (!commit) ratio = previous.ratio;
    else if (previous.holding) save();
    refresh();
  }
  const down = event => {
    if (!mobile.matches || !event.isPrimary || event.button !== 0) return;
    finish(); refresh();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, old: sizes.old, total: sizes.total, ratio, holding: false };
    grip.setPointerCapture(event.pointerId);
    grip.focus({ preventScroll: true });
    timer = setTimeout(() => {
      if (!gesture) return;
      gesture.holding = true;
      grip.classList.add('pcm-resizer-holding');
      dialog.classList.add('pcm-resizing-panes');
    }, 300);
    event.preventDefault();
  };
  const move = event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!gesture.holding) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) finish();
      return;
    }
    event.preventDefault();
    const next = paneHeights(gesture.total, (gesture.old + event.clientY - gesture.y) / gesture.total);
    ratio = next.old / next.total;
    refresh();
  };
  const up = event => { if (event.pointerId === gesture?.id) finish(true); };
  const cancel = () => finish();
  const anotherPointer = event => { if (gesture && event.pointerId !== gesture.id) finish(); };
  const key = event => {
    if (event.key === 'Escape' && gesture) { event.preventDefault(); event.stopPropagation(); finish(); return; }
    if (!mobile.matches || !['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault(); finish();
    const next = paneHeights(sizes.total, event.key === 'Home' ? 0.5 : sizes.old / sizes.total + (event.key === 'ArrowUp' ? -0.05 : 0.05));
    ratio = next.old / next.total; refresh(); save();
  };
  grip.addEventListener('pointerdown', down);
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', cancel);
  grip.addEventListener('lostpointercapture', cancel);
  grip.addEventListener('keydown', key);
  // 同一手势不交给列表拖拽或外层页面滚动，其他区域的触摸保持原行为。
  const stopTouch = event => event.stopPropagation();
  for (const name of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) grip.addEventListener(name, stopTouch, { passive: true });
  const stopMenu = event => event.preventDefault();
  grip.addEventListener('contextmenu', stopMenu);
  document.addEventListener('pointerdown', anotherPointer, true);
  window.addEventListener('blur', cancel);
  const resize = () => { finish(); schedule(); };
  window.addEventListener('resize', resize);
  mobile.addEventListener('change', resize);
  const observer = new ResizeObserver(schedule);
  observer.observe(header); observer.observe(dialog);
  const unsubscribe = onEnvironment(schedule);
  schedule();
  return {
    refresh,
    cancel,
    destroy() {
      finish(); cancelAnimationFrame(frame); observer.disconnect(); unsubscribe();
      window.removeEventListener('resize', resize); window.removeEventListener('blur', cancel);
      document.removeEventListener('pointerdown', anotherPointer, true);
      mobile.removeEventListener('change', resize);
      grip.remove();
    },
  };
}
