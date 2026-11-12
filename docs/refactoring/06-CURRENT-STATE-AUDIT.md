# E0 现状审计记录

日期：2026-11-12
审计分支：`refactor/v3`
审计基准提交：`fca3f63effd594da3d3a458b923e303f6aaa8fe6`
审计范围：前后端入口、路由模块、组件边界、SQLite schema 初始化、文件同步服务、现有自动化测试及已部署页面的只读浏览器观察。

## 1. 技术与仓库事实

- 前端：React 19、TypeScript、Vite、React Router 7。
- 后端：FastAPI、SQLite、Playwright。
- 前端生产构建：`cd frontend && npm ci && npm run build`。
- 后端测试：`cd backend && pytest -q`。
- 前端主要样式：`frontend/src/styles.css`，约 78 KB；已增加独立的 `styles/tokens.css`，正在逐步迁移旧选择器。
- 后端数据库：`app-data/library.sqlite`，当前 schema 声明 36 张表。
- 后端 API：7 个 router 文件，共 113 个路由声明。完整清单见 `09-API-DATA-INVENTORY.md`。

## 2. 前端组件审计与当前拆分

重构前 `App.tsx` 约 57 KB，混合应用 Shell、路由和多个页面。当前已缩减至约 5 KB，主要负责全局状态和路由组合。

已拆分：
- `AppSidebar.tsx`：导航。
- `LibraryPage.tsx`：资料库列表和空状态。
- `ReaderPage.tsx`：阅读器、Markdown 渲染和阅读工具组合。
- `QuestionsPages.tsx`：问题列表和详情。
- `SyncPage.tsx`：同步中心。
- `CategoriesPage.tsx`：分类管理。
- `SettingsPage.tsx`：设置。
- `types/ui.ts`：共享 UI 通知类型。
- `utils/format.ts`：日期格式化。

仍需进一步审计/拆分的较大模块：
- `ReaderWorkspace.tsx`：约 29.5 KB / 498 行，同时包含选区锚点、标注、高亮和个人笔记列表。
- `api.ts`：约 23.8 KB / 236 行，仍集中维护多领域请求。
- `styles.css`：约 78 KB / 534 行，多个选择器重复定义，需按组件边界渐进整理，不能一次性删改。

## 3. 自动化测试基线

GitHub Actions 已在以下提交运行前后端质量门槛：
- `9b0ce2f4742c5e5866634158cb1caa92747da238`：前端构建成功，后端 64 tests 成功。
- `567c80d7c1b14bd94f7c8203f4f91c2f2e8bcde1`：前端构建成功，后端测试成功。

运行记录：
- [CI 9b0ce2f](https://github.com/lin-deewin/zhiwei/actions/runs/43179043226)
- [CI 567c80d](https://github.com/lin-deewin/zhiwei/actions/runs/43179215630)

这些证据仅代表对应提交通过当前 CI；不等于 UI 人工验收、端到端测试或生产数据迁移演练已完成。

## 4. 后端数据与安全发现

- 36 张表覆盖 Library、Reading、PersonalKnowledge/Research、AI Retrieval 和 Markdown interop。
- SQLite 连接启用外键并使用 WAL。
- 当前迁移以 `CREATE IF NOT EXISTS` 和列存在性判断为主，`schema_version` 未形成完整的递增迁移登记机制。
- 首次引入阅读版本表前存在一次数据库备份逻辑，但不代表所有未来迁移均自动备份。
- Markdown 同步已实现路径穿越和符号链接检查、文件哈希确认和原子写入。
- AI API Key 保存在本地配置文件中；配置文件尝试使用 0600 权限。
- 远程访问由 `ZHILIB_ALLOW_REMOTE` 开启，CORS 白名单不是身份认证。远程部署必须另有反向代理/VPN/防火墙认证，不能直接暴露后端端口。

详细内容见 `09-API-DATA-INVENTORY.md`。

## 5. 生产环境观察

当前浏览器已打开 `https://zhiwei.deewins.top` 的旧版阅读页面。可见该部署仍使用旧版导航和现有阅读数据，不能作为 V3 分支的预览环境。

因此：
- 不在生产站点做删除、导入、同步或数据库迁移实验。
- 不把生产浏览器页面的表现归因于尚未部署的 V3 分支。
- 后续视觉验收需要独立预览环境或用户明确提供的测试实例。
- 真实知乎登录只使用用户自己的授权会话。

## 6. E0 状态

- [x] E0-01：静态盘点前端路由、页面入口和主要导航。
- [x] E0-02：识别超大组件并完成第一轮页面模块拆分；ReaderWorkspace、API 和 CSS 仍需继续细分。
- [x] E0-03：盘点 API router 和 SQLite 表；详细服务依赖图仍待补充。
- [x] E0-04：GitHub Actions 后端 pytest 全量通过（64 passed）。
- [x] E0-05：GitHub Actions 前端 TypeScript + Vite 构建通过。
- [ ] E0-06：实际回归阅读位置、高亮、批注、笔记、双向链接、研究和同步。
- [ ] E0-07：脱敏/副本数据库备份恢复演练、迁移风险和回滚验证。

## 7. 当前阻塞

当前没有将 V3 分支部署到独立预览环境，也没有生产资料库的可安全迁移副本。因此，浏览器端视觉验收、真实知乎会话验证和数据迁移验收仍未完成。不得以静态审计或 CI 成功代替这些验收。
