// 快照分享弹窗：选择快照、展示文件范围及本机依赖检查，确认后才下载或导入。
import {MAX_SNAPSHOT_SHARE_BYTES, MAX_SNAPSHOT_SHARE_COUNT} from '../snapshot-share.js';
import {snapshotScopeText} from './snapshot-scope.js';

const statusNames = {missing:'缺失', conflict:'冲突', unknown:'待核对', matched:'已匹配'};
const maxMiB = MAX_SNAPSHOT_SHARE_BYTES / (1024 * 1024);

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function button(label, action) {
  const el = node('button',label);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
}

function exportSummary(snapshot) {
  const section = node('section', undefined, 'pcm-share-item');
  const {scope, resources} = snapshot;
  section.append(node('h4', snapshot.name), node('p', '分享范围：' + snapshotScopeText(scope)));
  if (scope.preset) section.append(node('p', '所需预设：' + snapshot.presetName));
  if (scope.worlds) section.append(node('p', '全局世界书：' + ((snapshot.worldNames || []).join('、') || '无挂载')));
  for (const [included, label, rules] of [
    [scope.regex, '全局正则', resources?.regex?.global],
    [scope.presetRegex, '预设正则', snapshot.presetRegex?.switches],
  ]) {
    if (included) section.append(node('p', label + '：' + ((rules || []).map(rule => rule.name || rule.id).join('、') || '无')));
  }
  return section;
}

function importSummary(item, expanded) {
  const section = node('details', undefined, 'pcm-share-item');
  const checks = Object.keys(statusNames).flatMap(status => item.checks.filter(check => check.status === status));
  const counts = Object.entries(statusNames).map(([key, label]) => {
    const n = checks.filter(check => check.status === key).length;
    return n ? label + ' ' + n + ' 组' : '';
  }).filter(Boolean);
  const summary = node('summary');
  summary.append(node('strong', item.name), node('small', counts.join(' · ') || '无外部依赖'));
  section.append(summary);
  if (checks.length) {
    const rows = node('ul', undefined, 'pcm-share-checks');
    let shown = 0;
    const more = button('显示更多检查项', appendPage);
    function appendPage() {
      for (const check of checks.slice(shown, shown + 30)) {
        const row = node('li');
        row.dataset.shareStatus = check.status;
        row.append(node('strong', statusNames[check.status]), node('span', [check.label, check.detail].filter(Boolean).join(' · ')));
        rows.append(row);
      }
      shown = rows.childElementCount;
      more.hidden = shown >= checks.length;
    }
    section.append(rows, more);
    section.addEventListener('toggle', () => { if (section.open && !shown) appendPage(); });
    if (expanded) appendPage();
  }
  section.open = expanded;
  return section;
}

export function createSnapshotSharing({parent, toolbar, host, read, canOpen, onOpen, onClose, onImported, onDownload}) {
  let active = null;
  const batch = button('批量导出', () => {
    const session = start('选择要分享的快照', batch);
    if (!session) return;
    const choices = node('div', undefined, 'pcm-share-choices'), picked = new Set();
    const next = session.action('查看分享内容', () => prepareExport(session, [...picked]));
    const count = node('p');
    count.setAttribute('role', 'status');
    function sync() {
      count.textContent = '已选 ' + picked.size + ' 份' + (picked.size > MAX_SNAPSHOT_SHARE_COUNT ? '，每个文件最多 ' + MAX_SNAPSHOT_SHARE_COUNT + ' 份' : '');
      next.disabled = !picked.size || picked.size > MAX_SNAPSHOT_SHARE_COUNT;
    }
    for (const snapshot of read()) {
      const row = node('label'), input = node('input');
      input.type = 'checkbox'; input.value = snapshot.id;
      input.addEventListener('change', () => {
        if (input.checked) picked.add(snapshot.id); else picked.delete(snapshot.id);
        sync();
      });
      row.append(input, node('span', snapshot.name)); choices.append(row);
    }
    session.body.append(count, choices); sync();
    choices.querySelector('input')?.focus();
  });
  const choose = button('导入快照', () => {
    const session = start('导入快照预览', choose);
    if (!session) return;
    const fileInput = node('input', undefined, 'pcm-snapshot-share-file');
    fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
    session.dialog.append(fileInput);
    function chooseFile() { fileInput.value = ''; fileInput.click(); }
    const drawFilePicker = () => {
      session.reset('导入快照预览');
      session.body.append(node('p', '选择快照分享文件（JSON，最大 ' + maxMiB + ' MiB）。'));
      session.action('选择文件', chooseFile);
    };
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file || session.pending || !session.alive()) return;
      await session.run('正在核对分享文件和本机资源…', false, async () => {
        if (file.size > MAX_SNAPSHOT_SHARE_BYTES) throw Error('分享文件超过 ' + maxMiB + ' MiB，请分批导出。');
        const raw = await file.text();
        if (!session.alive()) return;
        let bundle;
        try { bundle = JSON.parse(raw.replace(/^\uFEFF/, '')); }
        catch { throw Error('文件不是有效的 JSON，请重新选择快照分享文件。'); }
        const preview = await host.request('snapshot-share-preview', {bundle});
        if (!session.alive()) return;
        session.reset('导入快照预览');
        session.body.append(node('p', file.name + ' · ' + preview.items.length + ' 份快照'),
          node('p', '导入会添加到快照列表，同名快照另存为副本。需要使用时，请手动切换快照。'));
        preview.items.forEach((item, i) => session.body.append(importSummary(item, i === 0)));
        session.action('重新选择文件', () => { drawFilePicker(); chooseFile(); });
        session.action('确认导入', () => session.run('正在导入快照…', true, async () => {
          const result = await host.request('snapshot-share-import', {bundle, contextKey:preview.contextKey});
          if (!session.alive()) return;
          onImported(result, preview.items.length);
          session.finish();
        }, drawFilePicker));
      }, drawFilePicker);
    });
    drawFilePicker();
    chooseFile();
  });
  toolbar.append(batch, choose);

  function start(title, opener) {
    if (active || !canOpen()) return null;
    const dialog = node('dialog', undefined, 'pcm-api-modal pcm-snapshot-share-dialog');
    const heading = node('h3'), body = node('div', undefined, 'pcm-share-body');
    const status = node('p', '', 'pcm-snapshot-status'), footer = node('div', undefined, 'pcm-share-actions');
    const cancel = button('取消', () => { if (!committing) finish(); });
    const outer = parent.closest('dialog');
    let committing = false;
    const session = {
      dialog, body, pending:false, alive:() => active === session, finish, reset,
      action(label, task) {
        const el = button(label, event => { if (session.alive() && !session.pending) task(event); });
        footer.append(el);
        return el;
      },
      async run(message, lockCancel, task, onError) {
        if (!session.alive() || session.pending) return;
        session.pending = true; committing = lockCancel;
        const enabled = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
        for (const el of enabled) el.disabled = true;
        cancel.disabled = committing;
        status.textContent = message;
        try { await task(); if (session.alive()) status.textContent = ''; }
        catch (error) {
          if (session.alive()) { onError?.(); status.textContent = error?.message || '快照操作失败'; }
        } finally {
          session.pending = false; committing = false;
          if (session.alive()) for (const el of enabled) el.disabled = false;
        }
      },
    };
    function reset(label) {
      heading.textContent = label; dialog.setAttribute('aria-label', label);
      body.replaceChildren(); footer.replaceChildren(cancel); status.textContent = '';
      body.scrollTop = 0;
    }
    function finish() {
      if (!session.alive()) return;
      active = null;
      outer?.removeEventListener('close', outerClose);
      if (dialog.open) dialog.close();
      dialog.remove(); onClose();
      if (parent.isConnected) (opener?.isConnected ? opener : choose).focus({preventScroll:true});
    }
    function outerClose(event) { if (event.target === outer) finish(); }
    dialog.addEventListener('cancel', event => {
      if (event.target !== dialog) return;
      event.preventDefault();
      if (!committing) finish();
    });
    dialog.addEventListener('close', finish, {once:true});
    outer?.addEventListener('close', outerClose);
    status.setAttribute('role', 'status'); dialog.append(heading, body, status, footer);
    active = session; onOpen(); parent.append(dialog); reset(title);
    dialog.showModal();
    return session;
  }

  async function prepareExport(session, ids) {
    await session.run('正在读取分享内容…', false, async () => {
      const bundle = await host.request('snapshot-share-export', {ids});
      if (!session.alive()) return;
      session.reset('导出快照');
      session.body.append(node('p', '文件包含 ' + bundle.snapshots.length + ' 份快照。接收方需另行准备对应的预设、世界书和正则。'),
        node('p', '文件按下列范围分享条目名称与开关、世界书关键词及条目配置、正则名称与开关、推理格式等。预设和世界书正文、正则脚本、绑定关系及 API 连接资料留在本机。'));
      for (const snapshot of bundle.snapshots) session.body.append(exportSummary(snapshot));
      session.action('下载分享文件', () => session.run('正在导出…', true, async () => {
        const result = await host.request('snapshot-share-download', {bundle});
        if (!session.alive()) return;
        onDownload(result.status); session.finish();
      }));
    });
  }
  return {
    update() {
      const blocked = !canOpen();
      batch.disabled = blocked || !read().length;
      choose.disabled = blocked;
      for (const el of parent.querySelectorAll('[data-share-snapshot]')) {
        el.disabled = blocked || parent.classList.contains('pcm-library-selecting');
      }
    },
    single(snapshot) {
      const el = button('导出', () => {
        const session = start('导出快照', el);
        if (session) void prepareExport(session, [snapshot.id]);
      });
      el.dataset.shareSnapshot = snapshot.id;
      return el;
    },
    destroy() { active?.finish(); },
  };
}
