// 临时库的桌面按住拖动／触屏长按拖动；落点与草稿事务由应用提供。
export function installTempLibraryDrag(root, { prepare, resolve, commit, lock, unlock, scrollEdge }) {
  const doc = root.ownerDocument, win = doc.defaultView, abort = new AbortController(), signal = abort.signal;
  let drag = null, frame = 0, marker = null, markerClass = '', suppressUntil = 0, edgeList = null, edgeDir = '', edgeSince = 0;
  const clearMarker = () => { marker?.classList.remove(markerClass); marker = null; markerClass = ''; };
  function createPreview() {
    const preview = doc.createElement('div'), title = doc.createElement('strong');
    preview.className = 'pcm-temp-drag-preview'; preview.dataset.tempDragPreview = ''; preview.setAttribute('aria-hidden', 'true');
    title.textContent = drag.data.item?.name || '世界书条目'; preview.append(title); root.append(preview);
    drag.preview = preview;
  }
  function updatePreview(target) {
    const preview = drag?.preview; if (!preview) return;
    preview.dataset.valid = String(!!target);
    const bounds = preview.getBoundingClientRect(), viewportWidth = doc.documentElement.clientWidth || win.innerWidth, viewportHeight = win.innerHeight;
    const x = drag.kind === 'touch' ? drag.x - bounds.width / 2 : drag.x + 14;
    const y = drag.kind === 'touch' ? drag.y - bounds.height - 22 : drag.y + 18;
    preview.style.left = `${Math.max(8, Math.min(x, viewportWidth - bounds.width - 8))}px`;
    preview.style.top = `${Math.max(8, Math.min(y, viewportHeight - bounds.height - 8))}px`;
  }
  function cancel() {
    const old = drag; drag = null; clearTimeout(old?.timer); win.cancelAnimationFrame(frame); frame = 0; clearMarker();
    root.classList.remove('pcm-temp-dragging'); old?.row.classList.remove('is-holding', 'is-dragging'); old?.preview?.remove();
    if (old?.active) { suppressUntil = Date.now() + 450; unlock(); }
    if (old?.kind === 'pointer' && root.hasPointerCapture?.(old.id)) root.releasePointerCapture(old.id);
  }
  function locate() {
    clearMarker(); if (!drag?.active) return null;
    if (Math.hypot(drag.x - drag.sx, drag.y - drag.sy) < 12) { updatePreview(null); return null; }
    const target = resolve(drag.data, doc.elementFromPoint(drag.x, drag.y), { x: drag.x, y: drag.y });
    if (target) { marker = target.marker; markerClass = target.className; marker?.classList.add(markerClass); }
    updatePreview(target);
    return target;
  }
  function tick() {
    if (!drag?.active) return;
    if (!drag.row.isConnected) { cancel(); return; }
    const edge = scrollEdge(drag.x, drag.y);
    if (edge?.list !== edgeList || edge?.dir !== edgeDir) { edgeList = edge?.list; edgeDir = edge?.dir; edgeSince = Date.now(); }
    if (edge && Date.now() - edgeSince >= 450) { const before = edge.list.scrollTop; edge.list.scrollTop += edge.delta; if (before !== edge.list.scrollTop) locate(); }
    frame = win.requestAnimationFrame(tick);
  }
  function begin() {
    if (!drag || drag.active || !drag.row.isConnected) return;
    drag.active = true; lock(); drag.row.classList.remove('is-holding'); drag.row.classList.add('is-dragging'); root.classList.add('pcm-temp-dragging'); createPreview();
    if (drag.kind === 'pointer') root.setPointerCapture?.(drag.id);
    edgeList = null; locate(); tick();
  }
  function start(event, point, kind) {
    const handle = event.target.closest?.('[data-temp-drag]'), row = handle?.closest('[data-temp-entry]');
    if (!row || !root.contains(row) || event.target.closest('button,input,select,textarea,a')) return;
    cancel(); const data = prepare(row.dataset.tempEntry); if (!data) return;
    drag = { row, data, kind, id: point.identifier ?? point.pointerId, sx: point.clientX, sy: point.clientY, x: point.clientX, y: point.clientY, active: false };
    if (kind === 'touch') { row.classList.add('is-holding'); drag.timer = setTimeout(begin, 450); }
  }
  function move(event, point) {
    drag.x = point.clientX; drag.y = point.clientY;
    if (!drag.active) {
      const distance = Math.hypot(drag.x - drag.sx, drag.y - drag.sy);
      if (drag.kind === 'touch') { if (distance > 8) cancel(); return; }
      if (distance > 4) begin();
    }
    if (drag?.active) { event.preventDefault(); event.stopPropagation(); locate(); }
  }
  function finish(event, point) {
    if (!drag) return;
    drag.x = point.clientX; drag.y = point.clientY;
    const active = drag, target = locate();
    if (active.active) { event.preventDefault(); event.stopPropagation(); }
    cancel(); if (active.active && target) commit(active.data, target);
  }
  root.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch' && e.button === 0) start(e, e, 'pointer'); }, { signal });
  doc.addEventListener('pointermove', e => { if (drag?.kind === 'pointer' && drag.id === e.pointerId) move(e, e); }, { signal, capture: true, passive: false });
  doc.addEventListener('pointerup', e => { if (drag?.kind === 'pointer' && drag.id === e.pointerId) finish(e, e); }, { signal, capture: true });
  doc.addEventListener('pointercancel', e => { if (drag?.kind === 'pointer' && drag.id === e.pointerId) cancel(); }, { signal });
  root.addEventListener('lostpointercapture', e => { if (drag?.kind === 'pointer' && drag.id === e.pointerId) cancel(); }, { signal });
  root.addEventListener('touchstart', e => { if (e.touches.length !== 1) { cancel(); return; } start(e, e.touches[0], 'touch'); }, { signal, passive: true });
  root.addEventListener('touchmove', e => { if (drag?.kind !== 'touch') return; if (e.touches.length !== 1) { cancel(); return; } const p = [...e.touches].find(p => p.identifier === drag.id); if (p) move(e, p); }, { signal, passive: false });
  root.addEventListener('touchend', e => { if (drag?.kind !== 'touch') return; const p = [...e.changedTouches].find(p => p.identifier === drag.id); if (p) finish(e, p); }, { signal, passive: false });
  root.addEventListener('touchcancel', cancel, { signal });
  root.addEventListener('click', e => { if (Date.now() < suppressUntil) { e.preventDefault(); e.stopImmediatePropagation(); } }, { signal, capture: true });
  root.addEventListener('dragstart', e => { if (e.target.closest?.('[data-temp-entry]')) e.preventDefault(); }, { signal });
  root.addEventListener('contextmenu', e => { if (e.target.closest?.('[data-temp-drag]')) e.preventDefault(); }, { signal });
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && drag) { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } }, { signal, capture: true });
  win.addEventListener('blur', cancel, { signal });
  win.addEventListener('resize', cancel, { signal });
  return { cancel, destroy() { cancel(); abort.abort(); } };
}
