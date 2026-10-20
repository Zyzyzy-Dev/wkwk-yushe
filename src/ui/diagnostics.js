// 预设更新编辑器 · 主动复制问题信息；剪贴板受限时显示可选择的只读文本，不自动上传。
import {diagnosticLog, formatDiagnosticReport} from '../shared/diagnostics.js';

let versionPromise, activeFallback = null;
const hostContexts = new WeakMap();

function within(promise, milliseconds, fallback) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), milliseconds);
    Promise.resolve(promise).then(value => {clearTimeout(timer);resolve(value);}, () => {clearTimeout(timer);resolve(fallback);});
  });
}

function pluginVersion() {
  // This is the extension's own static manifest, never a provider or user-configured URL.
  if (!versionPromise) versionPromise = within(fetch(new URL('../../manifest.json', import.meta.url), {cache:'no-cache'}).then(response => response.ok ? response.json() : null).then(data => data?.version), 1200, undefined);
  return versionPromise;
}

function hostContext(host) {
  if (!host || typeof host.request !== 'function') return Promise.resolve(undefined);
  if (!hostContexts.has(host)) hostContexts.set(host, within(Promise.resolve().then(() => host.request('diagnostics-context')), 1200, undefined));
  return hostContexts.get(host);
}

export async function collectDiagnosticReport({host} = {}) {
  const [version, context] = await Promise.all([pluginVersion(), hostContext(host)]);
  return formatDiagnosticReport({version, host:context, userAgent:globalThis.navigator?.userAgent, records:diagnosticLog.snapshot()});
}

function showManualCopy(text, trigger) {
  activeFallback?.close();
  const dialog = document.createElement('dialog');
  dialog.className = 'pcm-diagnostics-dialog';
  dialog.setAttribute('aria-label', '复制问题信息');
  Object.assign(dialog.style, {boxSizing:'border-box', width:'min(620px, calc(100vw - 24px))', maxHeight:'calc(100dvh - 24px)', padding:'16px', border:'1px solid var(--SmartThemeBorderColor, #888)', borderRadius:'12px', background:'var(--pcm-surface, #282828)', color:'var(--SmartThemeBodyColor, #ebdbb2)', overflow:'auto'});
  const title = document.createElement('strong');title.textContent = '复制问题信息';
  const hint = document.createElement('p');hint.textContent = '浏览器未允许自动复制，请选中下面的文字后复制。';
  hint.style.fontSize = '13px';
  const textarea = document.createElement('textarea');
  textarea.readOnly = true;textarea.value = text;textarea.setAttribute('aria-label', '问题信息');
  Object.assign(textarea.style, {display:'block', boxSizing:'border-box', width:'100%', height:'min(48dvh, 340px)', fontSize:'12px', lineHeight:'1.5', background:'var(--pcm-input-bg, #202020)', color:'inherit', border:'1px solid var(--SmartThemeBorderColor, #888)', resize:'vertical', whiteSpace:'pre-wrap'});
  const actions = document.createElement('div');Object.assign(actions.style, {display:'flex', justifyContent:'flex-end', gap:'8px', marginTop:'12px'});
  const select = document.createElement('button');select.type = 'button';select.className = 'menu_button';select.textContent = '全选';
  select.onclick = () => {textarea.focus();textarea.select();};
  const close = document.createElement('button');close.type = 'button';close.className = 'menu_button';close.textContent = '关闭';
  const controller = {close: () => {if(dialog.open&&typeof dialog.close==='function')dialog.close();dialog.remove();if(activeFallback===controller)activeFallback=null;if(trigger?.isConnected)trigger.focus();}};
  close.onclick = controller.close;
  dialog.addEventListener('cancel', event => {event.preventDefault();controller.close();});
  actions.append(select, close);dialog.append(title, hint, textarea, actions);
  (trigger?.closest('.pcm-dialog') || document.body).append(dialog);
  activeFallback = controller;
  try {dialog.showModal();} catch {dialog.setAttribute('open', '');Object.assign(dialog.style, {position:'fixed', zIndex:'2147483647', inset:'12px auto auto 12px'});}
  textarea.focus();textarea.select();
}

export function createDiagnosticsAction({host, toast, className = 'menu_button'} = {}) {
  const button = document.createElement('button');
  button.type = 'button';button.className = className;button.textContent = '诊断';
  button.dataset.diagnostics = 'copy';
  button.title = '复制版本、运行环境及最近操作状态，不包含密钥、正文或名称';
  // Warm only safe metadata, once per iframe; a later click can retain its clipboard user gesture.
  pluginVersion();hostContext(host);
  button.onclick = async event => {
    event.stopPropagation();if(button.disabled)return;button.disabled = true;
    try {
      const text = await collectDiagnosticReport({host});
      try {
        if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        toast?.('问题信息已复制', 'success');
      } catch {showManualCopy(text, button);}
    } finally {button.disabled = false;}
  };
  return button;
}
