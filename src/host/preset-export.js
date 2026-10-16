// 预设更新编辑器 · 将编辑器快照交给酒馆宿主下载，保留完整预设与分组字段。
// 浏览器只报告已发起下载；只有宿主明确回报保存完成才允许清除修改标记。
export async function exportPresetFile(payload, download) {
  if (!payload?.preset || !Array.isArray(payload.preset.prompts)) throw new Error('预设数据无效，未导出');
  if (typeof payload.name !== 'string' || !payload.name.trim()) throw new Error('导出文件名不能为空');
  if (typeof download !== 'function') throw new Error('当前酒馆不支持导出文件，请更新酒馆后重试');
  const name = payload.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!name) throw new Error('导出文件名无效');
  const content = JSON.stringify(payload.preset, null, 2);
  const result = await download(content, name, 'application/json;charset=utf-8', {throwOnFailure: true});
  if (result?.mode === 'failed') throw new Error('酒馆未能导出文件，请检查下载提示后重试');
  if (result?.cancelled === true || result?.mode === 'cancelled' || result?.completed === false) return {status: 'cancelled'};
  return {status: result?.savedPath || result?.completed === true ? 'saved' : 'started'};
}
