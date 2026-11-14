// 临时库对比面板：材料正文只读，独立标记差异方向，不注册为预设编辑表单。
const node = (tag, cls, text) => { const element = document.createElement(tag); if (cls) element.className = cls; if (text !== undefined) element.textContent = text; return element; };

export function createTempLibraryPreview(item, { diffSide }) {
  const section = node('section', 'pcm-version-editor pcm-temp-comparison');
  section.dataset.tempComparison = ''; section.setAttribute('aria-label', '临时库条目对比');
  const name = node('strong', 'pcm-temp-comparison-name', item.name), source = node('small', 'pcm-temp-comparison-source', item.source);
  const content = node('label', 'pcm-inline-content'), wrap = node('div', 'pcm-editwrap');
  const backdrop = node('pre', 'pcm-diff-backdrop'), area = node('textarea', 'pcm-live-area');
  backdrop.setAttribute('aria-hidden', 'true');
  area.dataset.diffSide = diffSide; area.readOnly = true; area.value = item.content || '';
  area.setAttribute('aria-label', '临时库正文（只读）');
  // 不设置 name=content，避免预设编辑工具把只读材料当作可保存表单。
  wrap.append(backdrop, area); content.append(node('span', '', '正文（只读）'), wrap);
  section.append(node('h4', '', '临时库'), name, source, content);
  return section;
}

// 两列的字段高度不同：按真实正文起点补齐空白，不给材料伪造预设设置。
// 手机上下排列时移除补齐；字段展开、工具栏换行、主题和窗口变化后重新测量。
export function alignTempLibraryBodies(forms) {
  const areas = [...forms.querySelectorAll('.pcm-live-area')];
  if (areas.length !== 2) return () => {};
  const labels = areas.map(area => area.closest('.pcm-inline-content'));
  const original = labels.map(label => label.style.paddingTop);
  const desktop = matchMedia('(min-width: 901px)');
  let frame = 0, disposed = false, padding = [0, 0];
  const apply = (index, value) => {
    if (Math.abs(padding[index] - value) < 0.1) return;
    padding[index] = value;
    labels[index].style.paddingTop = value ? value + 'px' : original[index];
  };
  const update = () => {
    frame = 0;
    if (disposed || !forms.isConnected) return;
    if (!desktop.matches || areas.some(area => !area.getClientRects().length || area.closest('[hidden]'))) {
      labels.forEach((_, index) => apply(index, 0));
      return;
    }
    const tops = areas.map((area, index) => area.getBoundingClientRect().top - padding[index]);
    const top = Math.max(...tops);
    tops.forEach((value, index) => apply(index, top - value));
  };
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  for (const node of forms.querySelectorAll('.pcm-version-editor,.pcm-inline-form,.pcm-inline-chat,h4,.pcm-temp-comparison-name,.pcm-temp-comparison-source')) observer?.observe(node);
  forms.addEventListener('change', schedule);
  forms.addEventListener('pcm-random-mode', schedule);
  window.addEventListener('resize', schedule);
  desktop.addEventListener('change', schedule);
  update();
  return () => {
    disposed = true; cancelAnimationFrame(frame); observer?.disconnect();
    forms.removeEventListener('change', schedule); forms.removeEventListener('pcm-random-mode', schedule);
    window.removeEventListener('resize', schedule); desktop.removeEventListener('change', schedule);
    labels.forEach((label, index) => { label.style.paddingTop = original[index]; });
  };
}
