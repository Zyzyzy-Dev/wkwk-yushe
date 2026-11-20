// 通过酒馆的下载接口导出 JSON，兼容浏览器下载和宿主原生保存／分享。
export async function downloadJsonFile(download, value, filename, indent) {
  if (typeof download !== 'function') throw new Error('当前酒馆不支持导出文件，请更新酒馆后重试');
  const name = filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!name) throw new Error('导出文件名无效');
  const result = await download(JSON.stringify(value, null, indent), name, 'application/json;charset=utf-8', {throwOnFailure:true});
  if (result?.mode === 'failed') throw new Error('酒馆未能导出文件，请检查下载提示后重试');
  if (result?.cancelled === true || result?.mode === 'cancelled' || result?.completed === false) return {status:'cancelled'};
  return {status:result?.savedPath || result?.completed === true ? 'saved' : 'started'};
}
