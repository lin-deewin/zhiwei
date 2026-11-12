# V3 后端 API、数据结构与安全现状审计

日期：2026-11-12
审计分支：`refactor/v3`
审计方式：静态读取 FastAPI 路由、SQLite 初始化与服务实现，并结合 GitHub Actions 自动化测试。本文不声称已经在生产数据副本上完成迁移演练。

## 1. 技术边界

- HTTP API：FastAPI，统一业务前缀 `/api/v1`。
- 持久化：SQLite，默认文件为资料库目录下的 `app-data/library.sqlite`。
- SQLite 连接：每个连接启用 `PRAGMA foreign_keys = ON`，超时 15 秒；初始化时切换 WAL。
- 文件内容：文章正文与附件位于本地资料目录，数据库主要保存元数据、关系、阅读记录、任务状态和检索索引。
- 配置：默认位于 `~/.local/share/zhihu-library/config.json`；目录权限尽可能设置为 0700，配置文件为 0600。AI API Key 以明文配置项保存，依赖本机文件系统权限保护。

## 2. API 路由盘点

当前 8 个路由模块，共 118 个路由声明：

| 路由模块 | 数量 | 主要职责 |
|---|---:|---|
| `api/routes.py` | 53 | 健康检查、账号/登录、收藏夹、设置、分类、内容、同步、分类任务、问题汇总 |
| `api/reading_routes.py` | 22 | 阅读上下文、高亮/批注、个人笔记、阅读 AI、阅读记录导入导出 |
| `api/knowledge_routes.py` | 6 | 证据检索、研究笔记生成、查询、保存和删除 |
| `api/graph_routes.py` | 10 | 知识节点、双向链接、主题页和链接解析 |
| `api/semantic_routes.py` | 7 | 语义索引任务、评测案例、检索评估 |
| `api/workspace_routes.py` | 9 | 研究项目、证据范围、追问、研究生成和版本恢复 |
| `api/markdown_routes.py` | 6 | Markdown/Obsidian 目录配置、预览、导入、导出和同步 |
| `api/personal_note_routes.py` | 5 | 独立个人笔记列表、详情、创建、更新和删除 |

### API 兼容性约束

1. V3 前端重构必须继续通过现有 `api.ts` 适配层调用后端，不在页面组件中散落裸 `fetch`。
2. 路径、HTTP 方法、请求字段、响应字段和错误码均视为兼容契约。
3. 删除/修改等写操作应保留已有幂等键、revision 乐观锁和冲突响应语义。
4. 新接口必须同时提供 Pydantic 输入约束、服务层校验和自动化测试。

## 3. SQLite 表盘点

当前 schema 声明 39 张表（原有 36 张 + 独立个人笔记 2 张 + 迁移登记 1 张）。按领域归类如下：

### Library / Sync

- `contents`
- `deleted_contents`
- `categories`
- `folders`
- `folder_contents`
- `sync_jobs`
- `classification_jobs`
- `classification_job_items`
- `questions`
- `question_contents`
- `question_classification_jobs`
- `question_classification_job_items`

### Reading

- `reading_library_meta`
- `content_revisions`
- `reading_content_state`
- `annotations`
- `notes`
- `reading_ai_jobs`
- `reading_ai_job_steps`
- `reading_ai_results`
- `reading_requests`
- `reading_import_items`
- `reading_migrations`

### Personal Knowledge / Research

- `knowledge_topics`
- `topic_drafts`
- `knowledge_links`
- `research_notes`
- `research_versions`
- `research_projects`
- `research_turns`
- `project_notes`

### Platform / Migration

- `schema_migrations`：按版本登记迁移名称和应用时间；当前已落地版本 2（personal_notes）。

### AI Retrieval / Markdown Interop

- `semantic_vectors`
- `semantic_jobs`
- `retrieval_cases`
- `markdown_sync_files`

### 已声明的关键索引

包括研究笔记状态、分类同级唯一性、内容更新时间/分类、收藏夹关联、分类任务创建时间、问题内容关联、批注/笔记内容关联、阅读 AI 任务复用和 AI 结果内容索引。全文检索另使用 SQLite FTS5 虚拟表 `content_search` 与 `note_search`。

## 4. 当前迁移机制与缺口

### 已确认实现

- 首次连接一个数据库文件时，基于文件路径、设备号和 inode 缓存初始化状态。
- `SCHEMA` 使用 `CREATE TABLE/INDEX IF NOT EXISTS` 创建缺失对象。
- 旧版数据库通过列存在性检查补充 `research_notes.revision`、`knowledge_topics.sources_json`、内容分类字段和同步时间字段。
- 阅读功能首次迁移前，如果已有 `contents` 而没有 `content_revisions`，会先使用 SQLite backup API 创建数据库副本。
- 阅读迁移记录写入 `reading_migrations`，当前代码写入版本 1。
- 部分文件写操作使用临时文件 + replace；Markdown 同步对相对路径、父目录穿越和符号链接做了边界校验。

### 需要在后续版本解决

1. `schema_migrations` 已建立有序迁移登记；当前版本 2 创建 `personal_notes` 与 `personal_note_sources`，并推进 `schema_version`。
2. 历史列补齐仍保留列存在性检查，后续应逐步纳入 registry。
3. 当前 v2 为纯新增表迁移；统一的迁移前自动备份策略尚未覆盖所有未来迁移。
4. 尚无生产数据副本上的完整升级、回滚、备份恢复演练。
5. 尚未对所有表的外键关系、级联删除策略、索引覆盖和迁移前后数据数量做机器化差异报告。

**结论：** 当前已有最小版本化迁移 registry，个人笔记迁移可重复执行且旧库数据保留测试已加入；但迁移前备份、失败回滚演练和完整 schema diff 尚未完成。不得直接在用户生产库上试验。

## 5. 文件系统与数据安全

### 正向控制

- 配置目录和配置文件写入时尝试设置较严格的 POSIX 权限。
- Markdown 互通模块验证相对路径、拒绝 `..`、绝对路径及符号链接。
- Markdown 导出采用原子替换写入，并对导入前文件哈希进行二次确认。
- 冲突解决路径会保留本地与外部版本副本。
- 删除内容时验证内容 ID 与文章目录路径，写入 `deleted_contents` 排除记录。

### 风险和待测项

- SQLite 主库及 WAL/SHM 文件权限尚未在跨平台环境中统一验证。
- 配置中的 AI API Key 是明文；应明确本地权限边界，后续可评估系统密钥链。
- 远程访问由 `ZHILIB_ALLOW_REMOTE` 显式开启，CORS 白名单不是身份认证。应用当前没有覆盖全部 API 的通用认证中间件；若启用远程访问，必须由可信反向代理/VPN/防火墙提供认证和网络隔离，禁止直接把后端端口暴露到公网。
- 文件路径校验仍需在 Windows、macOS、Linux 分别测试，尤其是符号链接、大小写、替换和并发写入场景。
- 内容删除目前在数据库事务中执行文件目录删除；需设计文件系统失败时的补偿/恢复测试。

## 6. 生产与开发环境隔离

当前浏览器中打开的是 `https://zhiwei.deewins.top` 的已部署页面，显示的是旧版导航和现有阅读数据。V3 分支尚未部署为该站点的预览版本。

因此：
- 不在生产站点上做删除、导入、同步或迁移实验。
- V3 的视觉验收应使用独立预览环境或用户明确提供的测试实例。
- 真实知乎登录测试必须使用用户自己的授权会话，不复制或导出生产会话。
- 迁移演练必须使用脱敏副本或完整备份副本。

## 7. 自动化验证基线

- 后端：当前仓库测试套件在 GitHub Actions 上通过，最近记录为 64 passed。
- 前端：TypeScript 项目构建与 Vite 生产构建此前通过；当前个人笔记页面在后续修正后尚待新一轮 CI 验证。
- 当前自动化尚未包含前端交互测试、浏览器端端到端流程、跨平台文件系统测试或真实数据迁移演练。
