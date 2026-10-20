// 预设更新编辑器 · iframe 通信桥：校验同源父窗口并接收一次性 MessagePort，
// 以 request/notify/on 三个接口与宿主进行 RPC 请求、通知和事件订阅。
const APP_ID = 'preset-compare-migrator';
import {stitchRpcTimeoutMs} from '../../features/preset/ai-stitch/timeout.js';
import {diagnosticLog} from '../../shared/diagnostics.js';
const CONNECT_MESSAGE = `${APP_ID}:connect`;
const REQUEST_TIMEOUT_MS = 30_000;

let port = null;
let requestId = 0;
let resolveConnection;
const connection = new Promise(resolve => {
  resolveConnection = resolve;
});
const pending = new Map();
const listeners = new Map();

function emit(name, payload) {
  for (const listener of listeners.get(name) || []) {
    try {
      listener(payload);
    } catch (error) {
      console.error(`[${APP_ID}] event listener failed`, name, error);
    }
  }
}

function onPortMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'event') {
    emit(message.name, message.payload);
    return;
  }
  if (message.type !== 'result') return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  clearTimeout(entry.timer);
  if (message.ok) {entry.finish('success');entry.resolve(message.value);}
  else {
    const error = new Error(message.error?.message || '宿主请求失败');
    error.name = message.error?.name || 'Error';
    if (message.error?.stack) error.stack = message.error.stack;
    entry.finish('failed', error.name);
    entry.reject(error);
  }
}

window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  if (location.origin !== 'null' && event.origin !== location.origin) return;
  if (event.data?.type !== CONNECT_MESSAGE || !event.ports?.[0] || port) return;
  port = event.ports[0];
  port.onmessage = message => onPortMessage(message.data);
  port.start();
  resolveConnection();
});

async function request(method, payload) {
  // Record only an allowlisted operation label, duration and outcome. Payloads and error text never enter the log.
  const finish = method === 'diagnostics-context' ? () => {} : diagnosticLog.begin(method);
  await connection;
  const id = ++requestId;
  // 多本世界书需要逐本保存与读回核验，不能沿用单次编辑操作的短超时。
  // Workbench import has two sequential disk reads (up to 45s each), plus the shared queue.
  // 宿主导出可能等待系统保存/分享窗口；超时仅报告未知状态，不自动再次下载。
  const timeoutMs = method === 'diagnostics-context' ? 1500 : method === 'ai-stitch-generate' ? stitchRpcTimeoutMs(payload?.timeoutMinutes) : method === 'ai-stitch-create' || method === 'ai-stitch-verify' || method === 'export-preset' || method.startsWith('snapshot-') || method.startsWith('api-manager-') || method === 'workbench-read-worldbook' ? 180_000 : REQUEST_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      finish('timeout');
      reject(new Error(`宿主请求超时：${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, finish });
    try {port.postMessage({ type: 'request', id, method, payload });}
    catch (error) {pending.delete(id);clearTimeout(timer);finish('failed', error?.name);reject(error);}
  });
}

async function notify(name, payload) {
  await connection;
  port.postMessage({ type: 'notify', name, payload });
}

function on(name, listener) {
  let group = listeners.get(name);
  if (!group) {
    group = new Set();
    listeners.set(name, group);
  }
  group.add(listener);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(name);
  };
}

export const host = Object.freeze({
  ready: () => connection,
  request,
  notify,
  on,
});
