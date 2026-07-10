# 开发指南

项目使用 Vite 和 `vite-plugin-monkey` 组织源码，并构建为单个、未压缩的 Userscript 文件。

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`（推荐使用 Node.js 22 LTS）
- npm 10 或更高版本

## 安装依赖

首次检出或仅需复现锁文件中的依赖时使用：

```bash
npm ci
```

只有在新增或升级依赖时才使用 `npm install`，并同时提交更新后的 `package-lock.json`。

## 开发与构建

监听源码变化并持续重新构建：

```bash
npm run dev
```

生成生产脚本：

```bash
npm run build
```

构建产物位于 `dist/downloader.user.js`。`dist/` 是生成目录，不提交到仓库。

## 源码结构

- `src/main.js`：Userscript 入口和样式注入
- `src/repository-ui.js`：GitHub 页面生命周期、表格注入和选择状态
- `src/github.js`：GitHub 页面解析、URL 构造和 API 请求
- `src/download.js`：选择项解析、下载、重试和 ZIP 输出
- `src/dialogs.js`：弹窗、下载状态和 Token 设置
- `src/config.js`：运行配置、DOM 选择器和日志
- `src/styles.css`：页面注入样式
- `vite.config.js`：Userscript 元数据和单文件构建配置

## 版本管理

Userscript 版本来自 `package.json`，构建配置不单独维护版本号。

升级补丁版本时执行：

```bash
npm version patch --no-git-tag-version
```

该命令会同时更新 `package.json` 和 `package-lock.json`。构建后应确认产物中的 `@version` 与包版本一致。

## CI 与发布

`.github/workflows/build.yml` 仅在以下情况执行：

- 推送到 `main` 分支
- 在 GitHub Actions 页面为 `main` 分支手动触发

CI 会安装锁定依赖、构建脚本、检查 JavaScript 语法和版本号，并上传完整的 `downloader.user.js` 构建产物。
