// 预设更新编辑器 · 酒馆宿主桥：唯一可接触 SillyTavern 主 document/API 的模块。
// 扩展菜单入口、外层 dialog/iframe 外壳、preset-manager/openai 动态读取与保存、
// PRESET_CHANGED 订阅转发、主题变量与 TauriTavern IME 高度转发。
import { applyPresetToMemory, shouldRefreshActivePreset } from './core.js';

const APP_ID = 'preset-compare-migrator';
const APP_TITLE = '预设更新编辑器';
// SillyTavern is the canonical host. TauriTavern integration is optional and
// lives behind runtime detection so the standard web path has no Tauri dependency.
const CONNECT_MESSAGE = `${APP_ID}:connect`;
const POST_MESSAGE_TARGET = location.origin === 'null' ? '*' : location.origin;
const THEME_VARIABLES = [
  '--SmartThemeBorderColor',
  '--SmartThemeBlurTintColor',
  '--SmartThemeBodyColor',
  '--mainFontFamily',
  '--monoFontFamily',
];

const clone = value => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function readPresetByName(manager, name) {
  const { presets, preset_names: names } = manager.getPresetList();
  let index = -1;
  if (Array.isArray(names)) index = names.indexOf(name);
  else if (names && typeof names === 'object' && names[name] !== undefined) index = Number(names[name]);
  return index >= 0 && index < presets.length ? presets[index] : null;
}

async function getPresetManager() {
  const module = await import('/scripts/preset-manager.js');
  const manager = module.getPresetManager?.('openai');
  if (!manager) throw new Error('当前酒馆版本未提供 OpenAI 预设管理接口');
  return manager;
}

async function listTavernPresets() {
  const candidates = new Map();
  const add = (name, preset) => {
    if (preset && Array.isArray(preset.prompts)) candidates.set(String(name || '未命名预设'), clone(preset));
  };
  const module = await import('/scripts/openai.js');
  const names = module.openai_setting_names || {};
  const settings = module.openai_settings || [];
  if (Array.isArray(names)) names.forEach((name, index) => add(name, settings[index]));
  else Object.entries(names).forEach(([name, index]) => add(name, settings[Number(index)]));
  return [...candidates.entries()];
}

async function handleRequest(method, payload) {
  if (method === 'list-presets') return listTavernPresets();
  if (method === 'read-preset') {
    const manager = await getPresetManager();
    return clone(readPresetByName(manager, String(payload?.name || '')));
  }
  if (method === 'save-preset') {
    const name = String(payload?.name || '');
    const preset = payload?.preset;
    if (!name || !preset || !Array.isArray(preset.prompts)) throw new Error('预设名称或数据无效');
    const manager = await getPresetManager();
    const saved = clone(preset);
    // 先看原生酒馆预设管理器当前选中的预设：同名才走 savePreset 的「重新应用刷新」路径
    // （updateList 会重选该项并触发 change → 重载生成设置并发出 PRESET_CHANGED）；
    // 不同名则用 skipUpdate 静默写盘，避免酒馆把活动预设切到被保存的预设，
    // 再手动把内存中的预设数据同步为 saved（updateList 被跳过，与 ST 自身 writePresetExtensionField 的用法一致）。
    const activeName = typeof manager.getSelectedPresetName === 'function'
      ? String(manager.getSelectedPresetName() || '') : '';
    if (shouldRefreshActivePreset(activeName, name)) {
      await manager.savePreset(name, saved);
    } else {
      await manager.savePreset(name, saved, { skipUpdate: true });
      const { presets, preset_names: names } = manager.getPresetList();
      applyPresetToMemory(presets, names, name, saved);
    }
    return clone(readPresetByName(manager, name));
  }
  throw new Error(`未知宿主请求：${method}`);
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || '',
  };
}

function applyImportantStyles(element, styles) {
  for (const [property, value] of Object.entries(styles)) element.style.setProperty(property, value, 'important');
}

function createHostDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = `${APP_ID}-host`;
  dialog.setAttribute('aria-label', APP_TITLE);
  applyImportantStyles(dialog, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100dvh',
    'max-width': 'none',
    'max-height': 'none',
    margin: '0',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    background: '#282828',
    color: '#ebdbb2',
  });

  const iframe = document.createElement('iframe');
  iframe.id = `${APP_ID}-frame`;
  iframe.title = APP_TITLE;
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  applyImportantStyles(iframe, {
    display: 'block',
    width: '100%',
    height: '100%',
    margin: '0',
    padding: '0',
    border: '0',
    background: 'transparent',
  });
  dialog.append(iframe);
  document.body.append(dialog);
  return { dialog, iframe };
}

class AppHost {
  constructor() {
    this.dialog = null;
    this.iframe = null;
    this.port = null;
    this.uiReady = false;
    this.openRequested = false;
    this.tavernEventsBound = false;
    this.environmentBound = false;
    this.ttKeyboard = 0;
    this.surfaceKeyboard = 0;
    this.ttSafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.environmentFrame = 0;
    this.scheduleEnvironment = () => {};
    this.tauriLayoutCleanup = null;
  }

  open() {
    this.openRequested = true;
    if (!this.dialog?.isConnected) this.mount();
    try {
      if (!this.dialog.open) this.dialog.showModal();
    } catch (error) {
      console.error(`[${APP_ID}] open host dialog failed`, error);
      this.dialog.setAttribute('open', '');
    }
    if (this.uiReady) this.sendEvent('open');
  }

  close() {
    this.openRequested = false;
    if (!this.dialog?.open) return;
    try {
      this.dialog.close();
    } catch {
      this.dialog.removeAttribute('open');
    }
  }

  mount() {
    const mounted = createHostDialog();
    this.dialog = mounted.dialog;
    this.iframe = mounted.iframe;
    this.dialog.addEventListener('close', () => {
      this.openRequested = false;
      this.sendEvent('host-closed');
    });
    this.bindEnvironment();
    this.bindTavernEvents();
    this.prepareIframe();
  }

  async prepareIframe() {
    this.iframe.addEventListener('load', () => this.connect());
    const tauriSetup = this.configureTauriSurface();
    if (tauriSetup) {
      // TauriTavern is an optional enhancement. Never let its adapter block the
      // standard SillyTavern iframe from loading if the host ABI is unavailable.
      await Promise.race([
        tauriSetup,
        new Promise(resolve => setTimeout(resolve, 1_200)),
      ]);
    } else {
      // A late-injected Tauri ABI still gets one non-blocking chance after the
      // standard iframe has started; on normal SillyTavern this remains a no-op.
      setTimeout(() => this.configureTauriSurface(), 1_500);
    }
    this.iframe.src = new URL('./ui/index.html', import.meta.url).href;
  }

  // TT 布局快照统一处理：layout-kit 与硬 ABI 两条订阅路径共用，转发键盘高度与安全区。
  applyTauriLayoutSnapshot(snapshot) {
    const keyboard = snapshot?.ime?.keyboardOffset;
    if (Number.isFinite(keyboard)) this.ttKeyboard = Math.max(0, keyboard);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const inset = snapshot?.safeInsets?.[side];
      if (Number.isFinite(inset)) this.ttSafeInsets[side] = Math.max(0, inset);
    }
    this.scheduleEnvironment();
  }

  configureTauriSurface() {
    if (!globalThis.__TAURITAVERN__) return null;
    return (async () => {
      // 首选官方 layout-kit（新 TT 提供）。旧版 TT 没有该文件（import 404 抛错），
      // 必须回退到硬 ABI：__TAURITAVERN__.api.layout.subscribe 是旧版 TT 唯一存在的
      // 键盘高度通道——只依赖 layout-kit 会让旧版 TT 的输入法适配整个失效。
      try {
        const layoutKit = await import('/scripts/tauritavern/layout-kit.js');
        await layoutKit.waitForHostReady?.();
        if (layoutKit.applySurface && layoutKit.SURFACE?.ViewportHost) {
          layoutKit.applySurface(this.iframe, layoutKit.SURFACE.ViewportHost);
        } else {
          this.iframe.dataset.ttMobileSurface = 'viewport-host';
        }
        if (layoutKit.subscribeLayout) {
          this.tauriLayoutCleanup = await layoutKit.subscribeLayout(
            snapshot => this.applyTauriLayoutSnapshot(snapshot),
          );
        }
      } catch (error) {
        console.warn(`[${APP_ID}] TauriTavern layout-kit unavailable, falling back to raw layout API`, error);
        try {
          await (globalThis.__TAURITAVERN__.ready ?? globalThis.__TAURITAVERN_MAIN_READY__);
          this.iframe.dataset.ttMobileSurface = 'viewport-host';
          const layout = globalThis.__TAURITAVERN__.api?.layout;
          if (layout && typeof layout.subscribe === 'function') {
            this.tauriLayoutCleanup = await layout.subscribe(
              snapshot => this.applyTauriLayoutSnapshot(snapshot),
            );
          } else {
            console.warn(`[${APP_ID}] TauriTavern layout API unavailable; IME forwarding disabled`);
          }
        } catch (fallbackError) {
          console.warn(`[${APP_ID}] TauriTavern raw layout API failed`, fallbackError);
        }
      }
    })();
  }

  connect() {
    this.port?.close();
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.uiReady = false;
    this.port.onmessage = event => this.onPortMessage(event.data);
    this.port.start();
    this.iframe.contentWindow.postMessage({ type: CONNECT_MESSAGE }, POST_MESSAGE_TARGET, [channel.port2]);
  }

  async onPortMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'request') {
      const replyPort = this.port;
      try {
        const value = await handleRequest(message.method, message.payload);
        replyPort?.postMessage({ type: 'result', id: message.id, ok: true, value });
      } catch (error) {
        console.error(`[${APP_ID}] host request failed`, message.method, error);
        replyPort?.postMessage({ type: 'result', id: message.id, ok: false, error: serializeError(error) });
      }
      return;
    }
    if (message.type !== 'notify') return;
    if (message.name === 'ready') {
      this.uiReady = true;
      this.bindTavernEvents();
      this.sendEnvironment();
      if (this.openRequested) this.sendEvent('open');
    } else if (message.name === 'close') {
      this.close();
    }
  }

  sendEvent(name, payload) {
    if (!this.port) return;
    this.port.postMessage({ type: 'event', name, payload });
  }

  bindTavernEvents() {
    if (this.tavernEventsBound) return;
    try {
      const context = globalThis.SillyTavern?.getContext?.();
      const eventSource = context?.eventSource || globalThis.eventSource;
      const eventTypes = context?.event_types || globalThis.event_types;
      if (!eventSource || !eventTypes?.PRESET_CHANGED || typeof eventSource.on !== 'function') return;
      eventSource.on(eventTypes.PRESET_CHANGED, data => {
        if (!data || (data.apiId && data.apiId !== 'openai') || !data.name) return;
        this.sendEvent('preset-changed', { apiId: data.apiId || 'openai', name: String(data.name) });
      });
      this.tavernEventsBound = true;
    } catch (error) {
      console.warn(`[${APP_ID}] SillyTavern preset event bridge unavailable`, error);
    }
  }

  bindEnvironment() {
    if (this.environmentBound) return;
    this.environmentBound = true;
    const schedule = () => {
      if (this.environmentFrame) return;
      this.environmentFrame = requestAnimationFrame(() => {
        this.environmentFrame = 0;
        this.sendEnvironment();
      });
    };
    this.scheduleEnvironment = schedule;
    window.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    // 活跃 IME 表面切换（data-tt-ime-active 只是布尔标记）或其内联 style 变化
    // （--tt-ime-bottom 由 TT 原生桥写在目标元素内联 style 上）都要重发环境快照。
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
    document.addEventListener('focusin', schedule, true);
    document.addEventListener('focusout', schedule, true);
  }

  environmentSnapshot() {
    const computed = getComputedStyle(document.documentElement);
    const theme = {};
    for (const variable of THEME_VARIABLES) {
      const value = computed.getPropertyValue(variable).trim();
      if (value) theme[variable] = value;
    }
    const cssKeyboard = Number.parseFloat(computed.getPropertyValue('--tt-viewport-bottom-inset'))
      || Number.parseFloat(computed.getPropertyValue('--tt-ime-bottom'))
      || 0;
    const visualKeyboard = window.visualViewport
      ? Math.max(0, window.innerHeight - window.visualViewport.height)
      : 0;
    /* Android TauriTavern 的 --tt-ime-bottom 是 surface-local：iframe 内聚焦时宿主 IME
       控制器在主 document 看到的 focusin 目标是 <iframe>（非可编辑元素），活跃表面被释放、
       布局订阅不再推送键盘高度，:root 上的 CSS 变量通道也为 0——键盘高度只由原生桥
       注入到默认 IME 目标元素的内联 style 上。因此直接从携带者读取：当前活跃 IME 表面
       （data-tt-ime-active）优先，#sheld 兜底（iframe 输入时的实际落点）。 */
    let surfaceKeyboard = 0;
    for (const carrier of [document.querySelector('[data-tt-ime-active]'), document.getElementById('sheld')]) {
      if (!carrier) continue;
      const value = Number.parseFloat(getComputedStyle(carrier).getPropertyValue('--tt-ime-bottom'));
      if (Number.isFinite(value)) surfaceKeyboard = Math.max(surfaceKeyboard, value);
    }
    this.surfaceKeyboard = surfaceKeyboard;
    const safeInsets = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const cssInset = Number.parseFloat(computed.getPropertyValue(`--tt-inset-${side}`)) || 0;
      safeInsets[side] = Math.max(0, this.ttSafeInsets[side] || 0, cssInset);
    }
    return {
      theme,
      safeInsets,
      keyboardOffset: Math.max(this.ttKeyboard, cssKeyboard, surfaceKeyboard, visualKeyboard),
      viewport: {
        width: window.visualViewport?.width || window.innerWidth,
        height: window.visualViewport?.height || window.innerHeight,
      },
    };
  }

  sendEnvironment() {
    const environment = this.environmentSnapshot();
    const background = environment.theme['--SmartThemeBlurTintColor'];
    const color = environment.theme['--SmartThemeBodyColor'];
    if (background) this.dialog?.style.setProperty('background', background, 'important');
    if (color) this.dialog?.style.setProperty('color', color, 'important');
    this.sendEvent('environment', environment);
  }
}

function addMenu(controller) {
  const menu = document.getElementById('extensionsMenu');
  if (!menu || document.getElementById(`${APP_ID}-button`)) return false;
  const entry = document.createElement('div');
  entry.id = `${APP_ID}-button`;
  entry.className = 'list-group-item flex-container flexGap5 interactable';
  entry.tabIndex = 0;
  const icon = document.createElement('span');
  icon.className = 'fa-solid fa-code-compare';
  const label = document.createElement('span');
  label.textContent = APP_TITLE;
  entry.append(icon, label);
  const open = () => controller.open();
  entry.addEventListener('click', open);
  entry.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  menu.append(entry);
  return true;
}

export function installPresetCompareHost() {
  const controller = new AppHost();
  const installMenu = () => {
    if (addMenu(controller)) return;
    const observer = new MutationObserver(() => {
      if (addMenu(controller)) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMenu, { once: true });
  else installMenu();
  return controller;
}

// 扩展更新 hook（ST 官方约定，manifest.hooks.update 指向本导出）：
// ST 在「扩展更新」成功后调用，扩展自行决定收尾。这里直接整页刷新，
// 让酒馆重新加载入口/宿主/iframe 全部脚本——比手动 F5 更可靠（无旧模块缓存），
// 也与 JS-Slash-Runner 的「更新成功后刷新页面以生效」同款行为。
export async function reloadAfterUpdate() {
  location.reload();
}
