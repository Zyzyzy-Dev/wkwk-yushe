// 预设更新编辑器 · 扩展入口：只安装并调用酒馆宿主控制器，功能全部在 src/ 模块中。
// reloadAfterUpdate 供 ST 在扩展更新成功后调用（manifest.hooks.update），刷新整页让新代码生效。
import { installPresetCompareHost, reloadAfterUpdate } from './src/host.js';

installPresetCompareHost();

export { reloadAfterUpdate };
