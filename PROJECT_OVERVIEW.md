# Smart Bookmark 项目说明

## 项目定位

Smart Bookmark 是一个面向 Chrome / Edge 的 AI 书签管理扩展，目标是把传统“收藏网页”升级为“可理解、可搜索、可同步、可整理”的知识入口。项目围绕三个核心场景展开：

- 收藏时自动生成标签，降低整理成本
- 搜索时支持自然语言检索，减少“记不住关键词”的挫败感
- 支持 WebDAV 同步、自定义筛选和批量操作，方便多设备与长期使用

## 当前能力

### 1. AI 增强收藏

- 保存网页时可调用模型生成标签
- 支持 OpenAI、通义千问、智谱、Ollama 及自定义兼容接口
- 已接入书签摘要、语义检索、AI 一键归类等能力

### 2. 多入口检索与操作

- 侧边栏主界面：浏览、搜索、编辑、删除书签
- 快速搜索窗口：通过 `Ctrl/Cmd + K` 唤起
- 快速保存窗口：通过 `Ctrl/Cmd + B` 唤起
- 地址栏关键词 `sb`：快速进入搜索

### 3. 数据管理与同步

- 支持导入导出书签
- 支持浏览器书签导入
- 支持 WebDAV 同步
- 支持自定义筛选规则与批量管理

## 代码结构

### 页面与入口

- `manifest.json`：扩展权限、入口页面、快捷键、omnibox 关键词
- `popup.html` / `popup.js`：侧边栏主界面
- `quickSearch.html` / `quickSearch.js`：快速搜索弹窗
- `quickSave.html` / `quickSave.js`：快速保存弹窗
- `settings.html` / `settings.js`：设置页
- `background.js`：后台任务与消息分发

### 核心功能模块

- `search.js`：搜索逻辑
- `importExport.js`：导入导出处理
- `filterManager.js` / `customFilter.js`：筛选规则管理
- `sync.js` / `webdavSync.js` / `webdavClient.js`：同步能力
- `aiCategorizer.js`：AI 一键归类
- `api.js` / `requestManager.js`：模型请求与接口适配
- `storageManager.js`：本地数据存取
- `config.js` / `settingsManager.js`：配置项与设置管理

### 资源文件

- `icons/`：扩展图标资源
- `css/`：页面样式
- `pic/`：README 和展示截图
- `_locales/`：多语言文案

## 运行机制概览

1. 用户通过侧边栏、快捷键或工具栏进入插件
2. 插件读取本地书签数据与设置
3. 需要 AI 时，由 `api.js` 按当前配置调用模型服务
4. 搜索、打标签、归类后的结果写回本地存储
5. 若启用同步，再通过 WebDAV 模块与远端数据合并或覆盖

## 适合展示给仓库访客的亮点

- 不依赖单一模型厂商，扩展性强
- 同时覆盖“收藏、整理、搜索、同步”完整闭环
- 具备浏览器扩展落地能力，不只是 Demo
- 支持本地模型 Ollama，适合隐私敏感或成本敏感场景

## 本地开发建议

1. 克隆仓库：

```bash
git clone https://github.com/ORDOABCHAOWT/SmartBookmark.git
cd SmartBookmark
```

2. 在 Chrome 或 Edge 中打开扩展管理页
3. 开启开发者模式
4. 选择“加载已解压的扩展程序”，指向当前项目目录
5. 在设置页配置测试用 API 服务后进行联调

## 发布前建议

- 检查是否误提交 API Key、导出 JSON、调试配置
- 复核 `manifest.json` 权限是否与实际功能一致
- 核对 README、截图、版本号与商店信息是否一致
- 发布前可参考 [PUBLISHING.md](PUBLISHING.md) 中的清单

## 仓库维护建议

- 将新功能说明优先体现在 `README.md`
- 将更偏技术说明的内容沉淀到本文档
- 发布版本时同步更新截图、版本徽章和变更说明
