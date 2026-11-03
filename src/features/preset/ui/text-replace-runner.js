// 查找替换后台任务：每次使用独立模块 Worker，在取消、异常或超时后终止，避免自定义正则阻塞编辑器。
const TASKS = new Set(['view', 'preview', 'apply']);

function abortError() {
  const error = new Error('查找替换任务已取消。');
  error.name = 'AbortError';
  return error;
}

/** Run regular-expression work off the UI thread; never retry on the main thread. */
export function runReplacementTask(type, payload, {signal, timeoutMs = 3000} = {}) {
  if (!TASKS.has(type)) return Promise.reject(new Error('未知的查找替换任务。'));
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let worker = null, timer = null, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker?.terminate();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(abortError());
    try {
      if (typeof Worker !== 'function') throw new Error('当前浏览器不支持后台正则查找，请使用普通文本模式或更换浏览器。');
      worker = new Worker(new URL('./text-replace-worker.js', import.meta.url), {type: 'module'});
      worker.addEventListener('message', event => {
        if (event.data?.ok === true) { finish(null, event.data.result); return; }
        const error = new Error(event.data?.error?.message || '后台查找替换任务未能完成。');
        if (event.data?.error?.code) error.code = event.data.error.code;
        finish(error);
      });
      worker.addEventListener('error', event => {
        event.preventDefault();
        finish(new Error('无法运行后台正则查找，请使用普通文本模式或更换浏览器。'));
      });
      worker.addEventListener('messageerror', () => finish(new Error('无法读取后台查找替换结果，请重新预览。')));
      signal?.addEventListener('abort', cancel, {once: true});
      if (signal?.aborted) { cancel(); return; }
      timer = setTimeout(() => {
        const error = new Error('正则处理超时，已停止本次任务。请简化表达式或缩小查找范围后重试。');
        error.code = 'REPLACEMENT_TIMEOUT';
        finish(error);
      }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000);
      worker.postMessage({type, payload});
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
