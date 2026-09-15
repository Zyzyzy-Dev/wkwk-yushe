<!-- src 目录说明：功能分层、宿主与 iframe 边界及资源加载规则。 -->
# 源码目录

- `host/`：酒馆宿主控制器。只有这一层调用 SillyTavern API、监听原生事件和访问主页面。
- `features/api/`：API 方案、附加参数、快照绑定；`ui/` 为编辑与选择弹窗。
- `features/snapshot/`：快照捕获、恢复、资源校验；`ui/` 为快照页面与草稿编辑。
- `features/worldbook/`：世界书转换、工作台数据操作；`ui/` 为选择、迁移、拖拽与对比界面。
- `features/preset/`：预设对比、迁移、分组、变量解析与批量变更计划；`ui/` 为布局、搜索高亮、正则样式与变量三视图。
- `shared/`：跨模块公共工具。
- `ui/app.js`：iframe 应用协调入口，组装各功能页面。
- `ui/index.html`：iframe HTML 入口，通过 module script 和 stylesheet link 加载资源。
- `ui/bridge/`：iframe 与宿主之间的专用消息通道。
- `ui/home/`、`ui/styles/`、`ui/assets/`：首页、公共样式和图片资源。

根目录 `index.js` 只导入并启动 `host/host.js`。JavaScript 使用显式 `import` / `export` 连接；CSS 由 iframe HTML 引用，图片由模块 URL 引用。不要向酒馆主页面注入功能 CSS，不要让运行时代码导入 `tests/`。

所有 JS、CSS、HTML 开头说明用途；二进制图片无法写注释，用资源目录说明记录用途。
