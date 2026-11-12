# AGENTS.md

## 这是什么

**dsh-git-assistant**：DeepSeek Harness 的 Git 工作台插件。把本地仓库的改动查看、暂存、提交、分支与提交图形整合进 Harness，尽量不离开会话完成 Git 操作。

## 三个入口

- 左侧栏 **Git** 图标 → 整页主面板
- 会话顶部标签 **Git** → 会话内视图
- 会话右侧栏 **Git** tab → 与原生对话并排

## 结构

- `src/index.js`：host 端插件，argv 方式调用本地 git（不经过 shell），暴露 `/git-assistant/api/*`。
- `src/client.js`：浏览器端 UI（单文件），含工作树卡片、diff、文件树与提交图形。
- `cordis.patch.yml` / `package.json`：插件清单与客户端注入声明。
- `scripts/`：smoke 渲染、车道算法校验、jsdom 交互回归。
- `locale/`、`icon.svg`：文案与图标。

## 功能范围

工作树卡片（分支、ahead/behind、同步、提交）；暂存/取消暂存/放弃；提交（普通/修改/推送/同步）；分支切换与新建；统一/并排 diff；文件浏览器（完整文件系统、Material 图标、图片/PDF/音视频预览）；提交图形（车道、悬浮卡、展开文件、提交 diff）；选中文本引用到对话、文件拖拽进输入框。

## 开发约定

- 优先本地 git 读取；只有用户主动推送/拉取时才联网。
- 写操作（提交、放弃、同步等）先在测试仓库验证。
- 插件重载：`plugin_manager set_bundle` 先关再开；客户端改动需要刷新页面。
- 提交前跑 `node --check src/client.js src/index.js` 和 `npm run smoke`。
