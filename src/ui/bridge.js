// 预设更新编辑器 · iframe 通信桥：校验同源父窗口并接收一次性 MessagePort，
// 以 request/notify/on 三个接口与宿主进行 RPC 请求、通知和事件订阅。
const APP_ID = 'preset-compare-migrator';
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
  if (message.ok) entry.resolve(message.value);
  else {
    const error = new Error(message.error?.message || '宿主请求失败');
    error.name = message.error?.name || 'Error';
    if (message.error?.stack) error.stack = message.error.stack;
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
  await connection;
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`宿主请求超时：${method}`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    port.postMessage({ type: 'request', id, method, payload });
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
