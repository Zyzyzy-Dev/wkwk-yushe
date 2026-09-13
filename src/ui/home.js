// 酒馆盒子首页：紧凑编辑入口与原创小猫插图，共享三主题，不接触预设状态。
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const star = svg('<path d="M12 2c1.2 6.3 3.7 8.8 10 10-6.3 1.2-8.8 3.7-10 10C10.8 15.7 8.3 13.2 2 12c6.3-1.2 8.8-3.7 10-10Z"/>');
const arrow = svg('<path d="M5 12h14m-6-6 6 6-6 6"/>');
const notesCat = new URL('./assets/kitten-notes.png', import.meta.url).href;
const boxCat = new URL('./assets/kitten-box.png', import.meta.url).href;
const comingSoon = new URL('./assets/kitten-coming-soon.png', import.meta.url).href;
const masterpiece = new URL('./assets/gpt-masterpiece.png', import.meta.url).href;

export function createToolboxHome({ themeIcon, onCycleTheme }) {
  const home = document.createElement('main');
  home.className = 'pcm-toolbox-home';
  home.innerHTML = `
    <header class="pcm-home-top">
      <div class="pcm-home-brand"><span class="pcm-home-brand-mark">${star}</span><h1>酒馆盒子</h1></div>
      <div class="pcm-toolbox-home-actions">
        <button type="button" class="pcm-toolbox-theme" data-theme-toggle title="切换插件配色：自适应 / 日间 / 夜间" aria-label="切换插件配色：自适应 / 日间 / 夜间"></button>
        <button type="button" class="pcm-toolbox-close" data-action="close" title="关闭插件" aria-label="关闭插件">${svg('<path d="m6 6 12 12M6 18 18 6"/>')}</button>
      </div>
    </header>
    <div class="pcm-home-content">
      <button type="button" class="pcm-toolbox-card" data-action="open-editor">
        <span class="pcm-toolbox-card-icon" aria-hidden="true"><img src="${notesCat}" alt="" width="128" height="128" draggable="false"></span>
        <span class="pcm-toolbox-card-copy"><strong>预设编辑</strong><small><span>预设对比 · 缝合 · 迁移</span><span>变量检查 · 预设正则缝合</span><span>世界书条目一键迁移到预设</span></small></span>
        <span class="pcm-home-card-go" aria-hidden="true">${arrow}</span>
      </button>
      <button type="button" class="pcm-toolbox-card pcm-snapshot-home-card" data-action="open-snapshots">
        <span class="pcm-toolbox-card-icon pcm-snapshot-home-icon" aria-hidden="true">${svg('<rect x="3" y="6" width="18" height="15" rx="3"/><path d="M8 6l2-3h4l2 3"/><circle cx="12" cy="13" r="4"/>')}</span>
        <span class="pcm-toolbox-card-copy"><strong>设置快照</strong><small><span>预设开关 · 全局世界书挂载</span><span>一键切换 · 绑定聊天或角色</span></small></span>
        <span class="pcm-home-card-go" aria-hidden="true">${arrow}</span>
      </button>
      <button type="button" class="pcm-toolbox-card" data-action="open-worldbook-workbench">
        <span class="pcm-toolbox-card-icon pcm-snapshot-home-icon" aria-hidden="true">${svg('<path d="M12 5v16M12 5C8 2 4 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-2-1-6-2-10 1Z"/>')}</span>
        <span class="pcm-toolbox-card-copy"><strong>世界书工作台</strong><small><span>世界书对比 · 编辑 · 拖拽迁移</span><span>预设条目转换并插入世界书</span></small></span>
        <span class="pcm-home-card-go" aria-hidden="true">${arrow}</span>
      </button>
      <button type="button" class="pcm-toolbox-card" data-action="open-api-manager">
        <span class="pcm-toolbox-card-icon pcm-snapshot-home-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6v4m-6-13v3a6 6 0 0 0 6 6"/></svg></span>
        <span class="pcm-toolbox-card-copy"><strong>API 管理</strong><small><span>地址与密钥 · 模型独立切换</span><span>保存当前连接 · 快速回复命令</span></small></span>
      </button>
      <img class="pcm-home-coming-soon" src="${comingSoon}" alt="更多酒馆工具将陆续加入" width="1536" height="1024" draggable="false">
    </div>
    <button type="button" class="pcm-home-flip" aria-label="点我翻转查看GPT巨作" aria-pressed="false">
        <span class="pcm-home-flip-inner">
          <span class="pcm-home-flip-face pcm-home-flip-front"><img src="${boxCat}" alt="纸盒里的小猫" width="288" height="192" draggable="false"><small>点我翻转查看GPT巨作</small></span>
          <span class="pcm-home-flip-face pcm-home-flip-back" aria-hidden="true"><img src="${masterpiece}" alt="手绘小猫" width="116" height="116" draggable="false"></span>
        </span>
      </button>
`;
  const theme = home.querySelector('[data-theme-toggle]');
  theme.innerHTML = themeIcon;
  theme.addEventListener('click', onCycleTheme);
  const flip = home.querySelector('.pcm-home-flip');
  flip.addEventListener('click', () => {
    const flipped = flip.classList.toggle('is-flipped');
    flip.setAttribute('aria-pressed', String(flipped));
    flip.setAttribute('aria-label', flipped ? '点击翻回小猫' : '点我翻转查看GPT巨作');
    flip.querySelector('.pcm-home-flip-front').setAttribute('aria-hidden', String(flipped));
    flip.querySelector('.pcm-home-flip-back').setAttribute('aria-hidden', String(!flipped));
  });
  return home;
}
