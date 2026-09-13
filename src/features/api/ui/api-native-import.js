// 酒馆原生连接方案选择弹窗：仅展示宿主筛选后的连接字段，通过方案 ID 导入。
export async function chooseNativeApiProfiles({ host, parent }) {
  const entries = await host.request('api-manager-native-list');
  const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };
  const dialog = node('dialog'); dialog.className = 'pcm-api-modal'; dialog.setAttribute('aria-label', '酒馆api方案');
  const form = node('form'); form.className = 'pcm-api-editor';
  form.append(node('h3', '酒馆api方案'), node('p', '选择要保存到 API 管理的方案，仅导入 URL、密钥引用和模型。'));
  const list = node('div'); list.className = 'pcm-native-api-list';
  const checks = [];
  if (!entries.length) list.append(node('p', '酒馆尚未保存连接方案。'));
  for (const entry of entries) {
    const row = node('label'); row.className = 'pcm-native-api-row';
    const input = node('input'); input.type = 'checkbox'; input.disabled = !!entry.error; input.setAttribute('aria-label', entry.name);
    const content = node('span'); content.append(node('strong', entry.name));
    const detail = node('small', entry.error || entry.profile.connection.custom_url + ' / ' + entry.profile.model);
    content.append(detail); row.append(input, content); list.append(row); checks.push({ input, entry });
  }
  const status = node('p'); status.setAttribute('role', 'status');
  const actions = node('div'); actions.className = 'pcm-snapshot-actions';
  form.append(list, status, actions); dialog.append(form); parent.append(dialog);
  return new Promise(resolve => {
    let busy = false;
    const close = count => { if (busy) return; dialog.close(); dialog.remove(); resolve(count); };
    const button = (label, callback) => { const b = node('button', label); b.type = 'button'; b.addEventListener('click', callback); actions.append(b); return b; };
    button('全选', () => { for (const {input, entry} of checks) if (!entry.error) input.checked = true; });
    const save = async () => {
      if (busy) return;
      const ids = checks.filter(({input, entry}) => input.checked && !entry.error).map(({entry}) => entry.id);
      if (!ids.length) { status.textContent = '请选择可导入的方案'; return; }
      busy = true; for (const b of actions.children) b.disabled = true;
      for (const {input} of checks) input.disabled = true;
      try { const result = await host.request('api-manager-native-import', { ids }); busy = false; close(result.count); }
      catch (error) {
        status.textContent = error.message; busy = false;
        for (const b of actions.children) b.disabled = false;
        for (const {input, entry} of checks) input.disabled = !!entry.error;
      }
    };
    button('导入所选', () => void save()); button('取消', () => close(0));
    form.addEventListener('submit', event => { event.preventDefault(); void save(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(0); }); dialog.showModal();
  });
}
