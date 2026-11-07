// 世界书工作台保存专用请求：分阶段超时、共享等待预算，只读核验不重发写入。
export function createWorkbenchSaveIO(env, {timeoutMs = 45000, budgetMs = 120000} = {}) {
  const deadline = Date.now() + budgetMs;
  let writeAttempted = false;
  function failure(label, detail, name = 'Error') {
    const hint = writeAttempted
      ? '保存请求已发出，但结果尚未确认；草稿已保留，请先导出草稿，再刷新酒馆核对，勿直接重复保存。'
      : '尚未发送保存请求，草稿已保留；请保持酒馆在前台后重试，或先导出草稿。';
    return Object.assign(new Error(label + detail + '。' + hint), {name});
  }
  async function request(url, body, label, write = false) {
    const remaining = Math.min(timeoutMs, deadline - Date.now());
    if (remaining <= 0) throw failure(label, '超时（本次保存等待时间已用完）', 'TimeoutError');
    const getHeaders = env.script.getRequestHeaders || globalThis.SillyTavern?.getContext?.().getRequestHeaders;
    if (typeof getHeaders !== 'function') throw failure(label, '失败：酒馆未提供读写接口');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const options = {method:'POST', headers:getHeaders(), body:JSON.stringify(body), cache:'no-cache', signal:controller.signal};
      if (write) writeAttempted = true;
      const response = await fetch(url, options);
      if (!response.ok) throw failure(label, '失败（HTTP ' + response.status + '）');
      if (write) {await response.arrayBuffer(); return;}
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw failure(label, '超时（' + Math.ceil(remaining / 1000) + ' 秒）', 'TimeoutError');
      if (error.name === 'AbortError') throw failure(label, '被中断');
      if (error.name === 'TypeError') throw failure(label, '失败：连接中断或无法读取响应');
      if (error.name === 'SyntaxError') throw failure(label, '失败：返回的数据格式异常');
      throw error;
    } finally {clearTimeout(timer);}
  }
  return {
    get writeAttempted() {return writeAttempted;},
    read: (url, body, label) => request(url, body, label),
    write: (url, body, label) => request(url, body, label, true),
    async names() {
      const data = await request('/api/settings/get', {}, '保存前世界书列表检查');
      if (!Array.isArray(data?.world_names) || !data.world_names.every(name => typeof name === 'string')) throw failure('保存前世界书列表检查', '失败：返回的数据不完整');
      return data.world_names;
    },
  };
}
