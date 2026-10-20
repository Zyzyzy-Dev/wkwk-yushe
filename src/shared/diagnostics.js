// 预设更新编辑器 · 问题信息白名单：仅保存有限操作状态与版本，不收集业务正文或异常原文。
const OPERATIONS = Object.freeze({
  'export-preset':'导出预设', 'list-presets':'读取预设列表', 'read-preset':'读取预设', 'save-preset':'保存预设',
  'list-worldbooks':'读取世界书列表', 'read-worldbook':'读取世界书',
  'workbench-read-worldbook':'工作台读取世界书', 'workbench-save-worldbook':'工作台保存世界书',
  'ai-stitch-connections':'读取缝合连接列表', 'ai-stitch-connection':'读取缝合连接', 'ai-stitch-models':'拉取缝合模型',
  'ai-stitch-generate':'生成缝合方案', 'ai-stitch-cancel':'取消生成', 'ai-stitch-create':'保存缝合预设', 'ai-stitch-verify':'复查缝合保存',
  'ai-stitch-draft-save':'保存缝合草稿', 'ai-stitch-draft-restore':'恢复缝合草稿', 'ai-stitch-draft-delete':'删除缝合草稿',
  'snapshot-list':'读取快照列表', 'snapshot-editor':'读取快照编辑器', 'snapshot-draft-preset':'读取快照预设', 'snapshot-draft-worlds':'读取快照世界书',
  'snapshot-save':'保存快照', 'snapshot-save-draft':'保存快照编辑', 'snapshot-rename':'重命名快照', 'snapshot-delete':'删除快照',
  'snapshot-apply':'应用快照', 'snapshot-bind':'绑定快照', 'snapshot-favorite':'收藏快照',
  'api-manager-list':'读取 API 方案', 'api-manager-links':'读取 API 绑定', 'api-manager-models':'拉取 API 模型',
  'api-manager-native-list':'读取原生连接列表', 'api-manager-native-import':'导入原生连接', 'api-manager-preflight':'检查 API 连接',
  'api-manager-save':'保存 API 方案', 'api-manager-delete':'删除 API 方案', 'api-manager-bind':'绑定 API 方案',
  'api-manager-apply':'切换 API 方案', 'api-manager-preferences':'更新快捷入口', 'other':'其他操作',
});
const OUTCOMES = Object.freeze({pending:'等待中',success:'成功',failed:'失败',timeout:'超时',cancelled:'已取消'});
const ERRORS = Object.freeze({Error:'请求失败',TypeError:'接口或网络异常',SyntaxError:'数据格式异常',RangeError:'数据范围异常',AbortError:'已取消',NotAllowedError:'权限受限',QuotaExceededError:'本地空间不足',DataCloneError:'数据无法传递'});
const own = (object, key) => typeof key === 'string' && Object.hasOwn(object, key);
const operationName = value => own(OPERATIONS, value) ? value : 'other';
const outcomeName = value => own(OUTCOMES, value) ? value : 'failed';
const errorName = value => own(ERRORS, value) ? value : 'Error';
const duration = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(86_400_000, Math.round(value))) : 0;
const dateValue = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? new Date(value).toISOString() : '未知';
const versionValue = value => typeof value === 'string' && /^v?\d{1,3}\.\d{1,3}\.\d{1,6}(?:-(?:test|alpha|beta|rc|dev|nightly)(?:[.-]\d{1,6})?)?$/.test(value) ? value.replace(/^v/, '') : '未知';

export function createDiagnosticLog({now = Date.now, limit = 20} = {}) {
  const records = [], count = Number.isInteger(limit) ? Math.max(1, Math.min(20, limit)) : 20;
  return Object.freeze({
    begin(method) {
      const row = {operation:operationName(method), at:now(), outcome:'pending', durationMs:0};
      records.push(row);
      if (records.length > count) records.splice(0, records.length - count);
      let completed = false;
      return (outcome, error) => {
        if (completed) return;
        completed = true;
        row.durationMs = duration(now() - row.at);
        row.outcome = outcomeName(outcome);
        if (row.outcome === 'failed' && error === 'AbortError') row.outcome = 'cancelled';
        if (row.outcome === 'failed') row.error = errorName(error);
      };
    },
    snapshot: () => records.map(row => ({...row, durationMs:row.outcome === 'pending' ? duration(now() - row.at) : row.durationMs})),
  });
}

export const diagnosticLog = createDiagnosticLog();

// Read only the existing fixed version label; do not fetch settings or inspect installed extensions.
export function readHostDiagnostics({tauri = false, versionText = ''} = {}) {
  const text = typeof versionText === 'string' ? versionText.slice(0, 160).trim() : '';
  const match = /^(SillyTavern|TauriTavern)\s+(\d{1,3}\.\d{1,3}\.\d{1,6})(?=$|\s)/.exec(text);
  const kind = tauri ? 'TauriTavern' : 'SillyTavern';
  return {kind, version:match?.[1] === kind ? match[2] : '未知', frontendVersion:match?.[1] === 'SillyTavern' ? match[2] : '未知'};
}

function browserDetails(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 1000) : '';
  const variants = [['Edge', /(?:Edg|EdgA|EdgiOS)\/(\d{1,3})(?:\.|\s|$)/], ['Firefox', /(?:Firefox|FxiOS)\/(\d{1,3})(?:\.|\s|$)/], ['Chrome', /(?:Chrome|CriOS)\/(\d{1,3})(?:\.|\s|$)/], ['Safari', /Version\/(\d{1,3})(?:\.|\s|$)/]];
  let browser = '未知';
  for (const [name, pattern] of variants) {const match = pattern.exec(ua);if(match){browser = `${name} ${match[1]}`;break;}}
  const platform = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS/iPadOS' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '未知';
  return {browser, platform};
}

export function formatDiagnosticReport({version, host, userAgent, records, now = Date.now()} = {}) {
  const kind = ['SillyTavern','TauriTavern'].includes(host?.kind) ? host.kind : '未知';
  const {browser, platform} = browserDetails(userAgent);
  const lines = ['酒馆盒子问题信息', `生成时间：${dateValue(now)}`, `插件版本：${versionValue(version)}`, `运行环境：${kind} ${versionValue(host?.version)}`];
  if (kind === 'TauriTavern') lines.push(`酒馆前端版本：${versionValue(host?.frontendVersion)}`);
  lines.push(`浏览器：${browser}`, `系统：${platform}`, '', '最近操作（仅当前页面，最多 20 条）：');
  const recent = Array.isArray(records) ? records.slice(-20) : [];
  for (const record of recent) {
    const op = operationName(record?.operation), outcome = outcomeName(record?.outcome);
    const issue = outcome === 'failed' ? `（${ERRORS[errorName(record?.error)]}）` : '';
    lines.push(`${dateValue(record?.at)} | ${OPERATIONS[op]} | ${OUTCOMES[outcome]}${issue} | ${duration(record?.durationMs)} ms`);
  }
  if (!recent.length) lines.push('暂无操作记录');
  lines.push('', '不含密钥、网址、角色名、预设名、正文或原始错误文本；仅复制到剪贴板，不自动上传。');
  return lines.join('\n');
}
