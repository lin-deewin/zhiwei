# E0 现状审计记录（初始）

日期：2026-11-12
审计范围：GitHub `main` 分支代码树、主要入口文件、设计文档与测试文件清单。
审计限制：本执行环境无法解析/连接 github.com，不能在此克隆仓库或运行 npm/pytest；因此本文件区分“静态检查发现”和“尚未实测”，不把静态检查冒充运行测试。

## 1. 仓库结构事实

- 前端：React 19、TypeScript、Vite、React Router 7；构建脚本为 `tsc -b && vite build`。
- 后端：FastAPI、SQLite；Python 项目配置在 `backend/pyproject.toml`。
- 前端入口：`frontend/src/App.tsx`；初步读取大小约 61 KB，包含应用 Shell、导航、路由及多个页面实现，存在继续拆分页面编排职责的价值。
- 全局样式：`frontend/src/styles.css`，文件约 77 KB，包含多个页面和响应式样式规则；后续应审计重复选择器和样式归属，不宜在未盘点前整体替换。
- 阅读：`frontend/src/components/ReaderWorkspace.tsx`；后端 `backend/app/services/reading_workspace.py`、`backend/app/api/reading_routes.py`。
- 知识：`KnowledgeHub.tsx`、`KnowledgePage.tsx`、`knowledge_graph.py`、`knowledge.py`、`semantic.py`、`rag.py`。
- 多标签：`WorkspaceTabs.tsx`。
- 现有设计文档：`DESIGN.md`、`IMPLEMENTATION.md`、`docs/reading-workspace-design.md`、`docs/reading-workspace-plan.md`、`docs/knowledge-research.md`、`docs/knowledge-evolution-plan.md`、`docs/user-guide.md`。

## 2. 测试资产静态清单

仓库测试目录包含以下 15 个测试模块及一个 conftest：
- `test_ai.py`
- `test_api_fallback.py`
- `test_classification.py`
- `test_content_deletion.py`
- `test_knowledge.py`
- `test_knowledge_graph.py`
- `test_library_list.py`
- `test_login.py`
- `test_markdown_sync.py`
- `test_questions.py`
- `test_research_workspace.py`
- `test_semantic.py`
- `test_sync.py`
- `test_workspace_api.py`
- `conftest.py`

GitHub Actions 已在提交 `d3846c89a23a3acf6c4bf5de958065c0e40f15ce` 上实际运行：前端 `npm ci` 与 `npm run build` 成功；后端 `pip install -e ".[dev]"` 与 `pytest -q` 成功。运行记录：[GitHub Actions run #43177156558](https://github.com/lin-deewin/zhiwei/actions/runs/43177156558)。这证明该提交通过仓库现有自动化质量门槛，不等于完成真实知乎登录、完整 UI 人工验收或生产数据迁移演练。

## 3. 已发现的产品结构问题（静态判断）

1. 原主导航把文章库、话题汇总、主题分类、知识问答、知识空间、我的笔记、同步中心并列，外部资料管理、个人创作、AI 和后台管理混在同一层级。
2. `App.tsx` 同时承载 Shell、导航、路由、全局状态和部分页面实现，长期演进存在高耦合风险。
3. 现有阅读工作区已经包含阅读标注、个人笔记和单篇 AI 阅读等能力；应先复用并明确边界，避免另建一套笔记系统。
4. 仓库已有知识链接、研究笔记、Markdown/Obsidian 互通能力；应保留并调整入口，而非直接删除。
5. 现有资料库文章列表已支持来源、分类、搜索、排序和分页；重构应保持这些能力并改善默认阅读路径。
6. 现有项目文档中部分实现状态带有日期，必须通过当前代码和实际运行重新确认。

## 4. 当前基线改动

在 `refactor/v3` 分支已经完成：
- 增加 V3 重构章程、信息架构、领域模型、执行计划、质量门槛和 Codex 执行规范。
- 将左侧导航重新组织为“核心工作区 / 资料管理 / 系统”分组；核心入口为资料库、个人笔记、AI 助手、研究工作区。原有路由保持不变。
- 将“文章库”主入口名称调整为“资料库”，常用分类区域名称调整为“常用主题”。

此导航调整属于第一轮信息架构落地，不代表全站页面重构已经完成。

## 5. 必须补齐的动态审计

- [x] 在 GitHub Actions 环境执行后端完整测试（`pytest -q` 成功）。
- [x] 执行前端 `npm ci && npm run build`（成功）。
- [ ] 检查 SQLite 实际 schema、迁移版本和外键。
- [ ] 使用备份副本验证旧资料库启动与升级。
- [ ] 实际操作：同步、离线阅读、阅读位置、高亮、批注、笔记保存。
- [ ] 实际操作：笔记双向链接、主题页、研究证据、AI 引用。
- [ ] 记录桌面端和窄屏截图，作为 UI 基线。
- [ ] 检查现有部署服务、环境变量、数据目录及恢复流程。

## 6. 阻塞与风险

本轮通过 GitHub Actions 获得了远程 CI 的构建和测试证据；当前会话仍没有可交互的本地仓库工作树，无法直接启动开发服务器、执行浏览器人工验收或连接用户真实资料库。后续涉及 UI 视觉质量、真实知乎接入、文件系统安全和数据迁移的验收仍须在可运行的部署/开发环境完成。
