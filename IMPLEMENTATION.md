# 知乎收藏知识库：编码实现方案

> 本文保留原编码顺序，作为后续开发参考。应用源码已位于 `backend/app/` 和 `frontend/src/`。扫码及浏览器会话已接入同步任务，真实知乎接口格式仍需账号实测；实际能力以 [docs/zhihu-capabilities.md](docs/zhihu-capabilities.md) 为准。

远程无桌面部署的登录改进见 [知乎页面内扫码登录实现方案](docs/zhihu-login-implementation.md)。方案实施中：无桌面浏览器和页面内验证画面已接入；扫码成功及重启恢复仍须账号本人实测。

## 1. 执行原则

1. 先验证知乎真实登录、收藏夹分页、文章/回答正文与来源字段；将实际证据和无法获取的字段写入 `docs/zhihu-capabilities.md`。不虚构平台接口或字段。
2. 保持“用户可离线阅读”和“数据可恢复”优先。完成一条从远端收藏到本地 Markdown 和阅读页的真实纵向链路，再扩展分类与 RAG。
3. 每阶段交付可运行代码、必要的单元/集成验证和简短使用说明。不能访问真实账号时明确未验证范围，并使用脱敏夹具验证解析和本地流程。
4. 隔离知乎适配器、Markdown 转换、持久化、任务、检索和模型调用。平台页面变化只应集中修改接入层。
5. 不提交用户 Cookie、模型密钥、文章导出或含私人正文的测试夹具。与平台交互须尊重用户权限和平台限制。

## 2. 建议目录与依赖

```text
article/
  readme.md
  prompt.md
  DESIGN.md
  IMPLEMENTATION.md
  AGENTS.md
  docs/
    zhihu-capabilities.md
    user-guide.md
  backend/
    pyproject.toml
    app/
      main.py
      api/                # 版本化路由与输入输出模型
      core/               # 配置、日志、异常、安全、路径校验
      db/                 # SQLite 连接、迁移、仓储
      domain/             # 内容与任务模型、业务服务
      adapters/zhihu/     # 登录、收藏夹枚举、正文获取、解析
      content/            # HTML 转 Markdown、图片、文件写入
      jobs/               # 持久化任务调度、同步、分类、索引
      search/             # 分块、jieba、FTS5、向量、检索
      ai/                 # Embedding、聊天、分类适配器
    tests/
      fixtures/           # 脱敏 HTML、分页和模型响应
  frontend/
    package.json
    src/
      api/                # 类型化 API 客户端
      components/         # 公用 UI
      pages/              # 同步、文章库、阅读、分类、问答、设置
      features/           # 领域状态与局部组件
    public/
  .gitignore
```

后端建议采用 Python 3.11+、FastAPI、Pydantic、SQLAlchemy 2 或明确的 `sqlite3` 仓储层、Alembic 或显式版本迁移、Playwright、BeautifulSoup、markdownify/turndown 等可替换转换器、jieba、NumPy、httpx、pytest。前端建议 React、TypeScript、Vite、React Router、TanStack Query、Markdown 渲染器以及能清理不安全 HTML 的插件。实际依赖以安装可用性为准；锁定版本并生成锁文件，不要为了满足名单引入未使用的库。

首版开发命令在脚手架完成后应明确实现并记录，例如：

```bash
cd backend && python -m venv .venv && .venv/bin/pip install -e '.[dev]'
cd backend && .venv/bin/python -m playwright install chromium
cd backend && .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
cd frontend && npm install && npm run dev
cd backend && .venv/bin/pytest
cd frontend && npm run build
```

上面是目标命令，不是当前仓库可执行命令。开发完成后用实际包管理器和脚本替换，更新 `AGENTS.md` 与用户指南。

## 3. 阶段 A：知乎接入可行性验证

**实现内容**

1. 建立 `ZhihuAdapter` 协议：`connect()`、`get_account_status()`、`list_folders()`、`iter_folder_items(folder_id)`、`fetch_content(kind, remote_id)`、`close()`。
2. 打开 Playwright 有界面浏览器的持久化用户配置目录，让用户自己完成知乎登录。若运行环境无显示设备，给出明确错误和文档，不尝试绕过验证。
3. 对用户拥有访问权的少量数据做只读探测，记录真实分页方式、稳定 ID、内容类型、时间字段、图片 URL、关联问题链接的来源。
4. 保留响应数据的脱敏样本作为解析回归夹具；不要保存 Cookie、令牌或未经用户同意的完整私密正文。
5. 标准化适配器输出，而不是将平台 HTML 或不稳定字段直接传播到数据库和 UI。

当前实现：设置页定期读取 `/account` 展示真实状态。主入口使用 Xvfb 和普通 Chrome，在知微页面展示安全验证或二维码；已保存会话在服务启动时重新校验。显式配置 `ZHILIB_CHROME_CDP_URL` 的旧外部浏览器入口仍保留。无桌面启动与安全验证画面已实测，真人扫码成功和重启恢复仍待验证。

**标准化模型示例**

```python
class RemoteItem(BaseModel):
    kind: Literal["article", "answer", "unsupported"]
    remote_id: str
    source_folder_id: str
    url: str | None = None
    remote_updated_at: datetime | None = None

class RemoteContent(BaseModel):
    kind: Literal["article", "answer"]
    remote_id: str
    title: str
    url: str
    author: str | None = None
    html_body: str
    published_at: datetime | None = None
    remote_updated_at: datetime | None = None
    question: QuestionRef | None = None
```

回答所属问题放入 `QuestionRef`。如果知乎当前页面无法提供某字段，设为 `None`，并记录能力限制。解析失败需要可识别的错误类型。

**阶段验收**：记录真实或受限原因；若登录可用，能分页列出至少一个收藏夹并获取一篇文章的可读正文。否则先完成适配器接口与夹具验证，并清楚说明真实同步仍受阻。

## 4. 阶段 B：资料库与离线保存

### 4.1 数据库迁移

按 `DESIGN.md` 的概念模型创建首版迁移。至少保证：`contents(kind, remote_id)` 唯一、`folders(remote_id)` 唯一、`folder_contents(folder_id, content_id)` 唯一、分类树父子外键、任务状态枚举、索引版本字段。开启 SQLite 外键和 WAL；数据库连接由请求/任务生命周期管理。不要在请求处理函数里拼接 SQL 字符串。

将资料目录配置与数据库位置分离：操作系统私有应用配置保存当前资料目录路径；资料目录下的 `app-data/library.sqlite` 保存该资料库数据。切换资料目录时先关闭旧库和任务，再加载目标库；存在非空且不属于本应用的目录时提示用户确认，不自动清理。

### 4.2 文件写入器

创建 `LibraryWriter.save(remote_content, converted_markdown, assets)`，流程如下：

1. 验证 `(kind, remote_id)` 和目标路径，拒绝非法 ID、路径穿越与符号链接逃逸。
2. 下载图片到临时文件，检查 HTTP 状态、MIME、大小上限和文件签名；计算 SHA-256，使用 `assets/<hash>.<ext>` 保存。
3. 将 HTML 转换为 Markdown，正文图片替换为相对路径；无法下载的图片保留来源 URL，并在元数据中记录失败。
4. 生成 `article.md` 与 `metadata.json` 的临时版本。`metadata.json` 至少包含 `schema_version`、来源 ID/类型/URL、作者与时间、收藏夹、问题、分类、正文与文件哈希、图片结果和同步时间。
5. 对已有文件先比对上次 `file_hash`。用户编辑过则生成候选文件并记录冲突；未修改才原子替换。数据库状态只能在实际文件落盘后标记为可读。
6. 清理无引用的临时文件。进程意外退出后，通过启动修复流程检查临时文件、数据库路径和实际文件是否一致。

**阶段验收**：打开本地 `article.md` 可读正文；断网时本地图片仍显示；重复保存同一内容不增加目录；中断写入和本地修改都不会毁坏原文件。

## 5. 阶段 C：同步任务与账号接口

### 5.1 任务状态机

`queued → scanning → downloading → finalizing → completed`；任一阶段可转为 `failed`、`cancelled` 或 `interrupted`。会话失效使用 `auth_required`，重新登录后允许继续。每个收藏夹有自己的 `scan_run`；只有完整扫描成功才可以处理本轮未见到的收藏关系。任务启动前获得单资料库同步锁；失败和进程退出时释放或恢复锁。

每个任务保留以下计数：`folder_entries_scanned`（可重复来源条目）、`unique_contents_seen`（去重内容）、`new`、`updated`、`unchanged`、`failed`、`unsupported`、`partial_assets`、`postprocess_pending`。扫描未完成时总量为未知，UI 显示扫描页数和已发现数量，不计算误导性的百分比。

### 5.2 全量与增量算法

```text
for folder in selected_folders:
    begin_scan_run(folder)
    for page in adapter.iter_folder_items(folder):
        persist each observed folder-content relation and item status
        collect unique (kind, remote_id)
    if last page reached successfully:
        mark_scan_complete(folder)
        mark previously known but unseen relations as not_in_remote
    else:
        mark_scan_failed(folder)  # 不更新旧关系的消失状态

for unique item:
    if cancelled: stop after current item
    if new: fetch and save
    elif full: fetch; compare hash and local file; save if changed
    elif remote version indicates change: fetch and save
    else: unchanged
    persist item result; enqueue classification/index work separately
```

实际代码要边扫描边按批处理，避免将全部条目一次性放入内存；上述伪代码只定义语义。列表分页检查点、条目去重和文件状态需持久化。扫描失败可保留已下载内容，但不得推断远端取消收藏。平台限流采用有上限的指数退避和抖动；认证和权限错误立即停止对应任务。并发默认保守，例如 2 个正文请求；通过设置调整，不能无限并发。

### 5.3 API 契约（`/api/v1`）

| 方法与路径 | 作用 | 关键输入/输出 |
| --- | --- | --- |
| `GET /account` | 查询连接状态 | `status`, `display_name?`, `reason?`；不返回会话 |
| `POST /account/connect` | 发起浏览器登录 | 登录任务 ID / 状态 |
| `POST /account/disconnect` | 退出连接 | 成功状态；本地文章保留 |
| `GET /folders` | 列出可用收藏夹 | ID、名称、URL、可用数量 |
| `GET /settings` / `PATCH /settings` | 目录与非秘密设置 | 校验本地目录及模型参数 |
| `POST /sync-jobs` | 创建同步任务 | `{ mode: "full"|"incremental", folder_ids: [...] }`，返回 `202` 与 `job_id` |
| `GET /sync-jobs/{id}` | 任务快照 | 阶段、计数、当前内容、错误 |
| `GET /sync-jobs/{id}/events` | SSE 进度流 | 单调事件 ID，重连后先取快照 |
| `POST /sync-jobs/{id}/cancel` | 请求取消 | 更新取消标记 |
| `POST /sync-jobs/{id}/retry` | 重试失败或中断项 | 新任务 ID，保留原始历史 |
| `GET /contents` | 文章列表 | 分页、分类、收藏夹、类型、排序 |
| `GET /contents/{id}` | 阅读页元数据 | 正文入口、来源、分类、问题 |
| `GET /contents/{id}/markdown` | 获取安全处理的正文 | 仅资料库内的受控文件 |
| `GET /contents/{id}/assets/{asset_id}` | 获取图片 | 根据资产表映射，禁止任意路径输入 |

错误统一返回 `code`、`message`、`retryable`、`details?`；例如 `AUTH_EXPIRED`、`RATE_LIMITED`、`DIRECTORY_NOT_WRITABLE`、`CONTENT_UNAVAILABLE`、`FILE_CONFLICT`。所有列表接口使用明确的分页参数和最大页大小。变更请求校验本地同源来源与 CSRF；拒绝异常 `Host`。SSE 事件只能读取指定任务，事件中不含正文或凭据。

**阶段验收**：刷新页面任务继续；同一内容位于两个收藏夹时正文只写一次；全量重跑不重复写；增量能发现新收藏；分页失败不误标取消收藏；取消和重启后可恢复。

## 6. 阶段 D：前端文章库与阅读

前端路由建议：`/setup`、`/sync`、`/library`、`/read/:id`、`/categories`、`/ask`、`/settings`。用类型化 API 客户端统一处理认证失效、错误码与加载状态。同步页先请求任务快照，再连接 SSE；掉线时重连，不将“页面没收到事件”等同于任务失败。

文章库使用服务端分页和筛选。阅读页从受控 Markdown 接口加载，渲染标题、图片、表格、代码块和引用；对原始 HTML 做安全清理。目录根据标题层级生成，图片点击可放大。来源区域分别标注收藏夹、关联问题和本地分类；收藏夹关系链接到知乎收藏夹，回答的关联问题链接到其知乎问题页；无法读取远端数据时仍可离线阅读。响应式适配窄屏。

当前文章库卡片已采用内容优先的紧凑布局：去除占高的纯色封面，保留细色标，展示标题、摘要及完整分类路径；网格和列表视图都需在窄屏下保持可读。

当前前端已统一放大导航、按钮、表单、任务进度、文章摘要和阅读正文的字号；窄屏文章库在空间不足时切换单列，避免放大字体后内容拥挤。

**阶段验收**：用真实保存的文章验证图片相对路径、目录跳转、长代码与宽表格、来源链接及空状态。截图用于人工核对排版。

## 7. 阶段 E：分类与主题管理

新增接口：`GET/POST/PATCH/DELETE /categories`、`PATCH /contents/{id}/classification`、`POST /classification-jobs`、`GET /classification-jobs`、`GET/POST .../{id}/cancel|retry`。分类任务先使用内置离线词表，建立两级主题树（仅在树为空时），读取正文并记录可解释命中理由；规则无法确定且已配置聊天模型时自动请求模型，模型仍不确定的文章进入待整理，模型请求失败进入可重试失败项。预置词表增加数学、硬件、书籍、哲学宗教、内容创作和情感关系等小类；旧资料库通过分类结构版本一次性补入，不重跑已整理文章。标题线索须有正文佐证，或是明确且无冲突的专有词。新任务通过条目历史只选未整理过的新增文章，已经归类或留在待整理的文章不重跑；失败、取消、中断的条目由原任务重试。文章列表接口支持 `pending_only=true`，文章库提供待整理筛选。分类删除会清除被移入待整理文章的锁定和规则哈希。用户手动选类或点击确认后设置 `locked=true`。

模型分类输入包含标题、正文选段和所有有效叶子分类的 ID/名称；输出必须通过 Pydantic 解析与数据库 ID 校验。返回不存在的 ID、顶层节点或空理由时标记“待分类”或错误，不写入无效结果。批量任务只处理未锁定内容，提供进度与失败列表。模型未配置时入口说明原因，人工分类照常可用。分类变更更新 `metadata.json` 和列表筛选，文章目录不移动。

**阶段验收**：两级分类创建/修改/删除可用；模型无法判断进入待分类；人工锁定后批量重跑不覆盖；删除类目不删除文章。

## 8. 阶段 F：全文搜索、语义检索与 RAG

### 8.1 分块与索引

`IndexService.index_content(content_id)` 从当前选定的 Markdown 版本读取正文，按标题和段落切块，保存 `content_hash`、`chunk_no`、`heading`、偏移或锚点。更新内容时在同一事务中替换该文章的 `chunks` 与 FTS 记录，并将向量状态设为待生成；引用不应指向旧版本。读到用户修改的文件时，先处理冲突或明确选择本地版本。

用 jieba 对标题和正文预分词，索引到 SQLite FTS5。查询端使用相同 tokenizer 并正确转义 FTS 查询语法，防止用户输入引发语法错误。关键词检索优先返回 FTS 命中，单字或异常查询走受限范围的子串回退。结果排序可结合标题命中、FTS 排名和更新时间。

### 8.2 模型配置与向量

设置项区分聊天模型和 Embedding 模型：服务地址、模型名、超时、批量大小；密钥存 OS 私有配置或凭据库，前端仅看到是否已配置。配置检查使用轻量请求，失败要给出原因。向量以固定维度 `float32` BLOB 保存在 SQLite，记录模型 ID 和维度。查询时只加载当前模型且索引完成的向量，批量 NumPy 计算余弦距离。更换模型或维度后不混用向量，启动重建任务。

### 8.3 检索与回答接口

| 方法与路径 | 作用 |
| --- | --- |
| `GET /search?q=&folder_id=&category_id=&mode=keyword|hybrid` | 返回分页的文章/片段结果及索引覆盖提示 |
| `POST /index-jobs` | 重建全文与/或向量索引，返回任务 ID |
| `GET /index-status` | 文章数、已索引数、待处理数、模型版本 |
| `POST /ask` | 输入问题与筛选范围，返回回答、引用和检索状态 |

混合检索先从 FTS 与向量各取候选，再根据范围过滤，按归一化分数或 RRF 合并，去掉同篇重复片段，最多选择 6–10 个片段进入问答。每个片段带后端生成的 `citation_id`。模型可以在回答中引用这些 ID，后端只接受确实进入本次提示词的 ID，并映射到 `/read/:id#<heading-or-chunk>`。若没有合格片段、回答无可验证引用或模型失效，返回明确的不足或错误状态。远端文章中的提示词样式文字一律作为检索内容，不能触发工具或配置操作。

**阶段验收**：中文短词与标题搜索有效；按收藏夹/分类筛选后不越界引用；正文更新后旧片段失效；RAG 回答引用可点且定位正确；模型未配置时关键词搜索仍可用。

## 9. 关键测试与质量门槛

为有行为风险的核心模块写自动化测试；UI 排版和真实平台访问还需人工验证。至少覆盖：

- **适配器**：脱敏的多页收藏夹、文章、回答和字段缺失夹具；解析出稳定 ID、来源问题。
- **同步**：重复全量、增量新增、同文多收藏夹、分页中断、认证失效、取消、失败重试、重启恢复、远端取消收藏。
- **文件**：Markdown 与图片离线可读、图片响应非图片时拒绝保存、原子写入失败、本地修改冲突、路径穿越拒绝。
- **分类**：无效模型分类 ID、人工锁定、删除分类迁移。
- **检索**：中文检索、筛选范围、内容更新后的旧索引清除、模型版本不匹配、假引用拒绝、无证据回答。
- **前端**：最关键的首次设置、同步进度、阅读页和问答引用交互；测试框架由实际前端工具链确定。

实时知乎集成验证只在用户提供自己的登录环境后执行；不要把夹具通过视为真实平台已验证。完成每阶段后记录运行命令、结果、剩余限制；所有功能声明以实测为准。性能验收建议使用脱敏或生成的约 1,000 篇文章检查列表分页、搜索延迟和内存占用，作为优化依据，而不是先引入复杂基础设施。

## 10. Lunu 的最终交付清单

完成后提交以下内容，并在最终答复中逐项对照：

1. 可启动的前后端源码、锁文件、数据库迁移、`.env.example` 和 `.gitignore`。
2. `docs/zhihu-capabilities.md`：真实接入验证路径、字段能力、访问限制和未验证内容。
3. `docs/user-guide.md`：安装、登录、选择目录、全量/增量同步、分类、阅读、模型配置和备份恢复。
4. 更新 `AGENTS.md` 中的真实目录和可执行命令。
5. 自动化验证结果、人工验证记录、未解决问题和明确的能力边界。

实施顺序按 A→F 推进。若真实知乎接入受阻，继续完成可独立验证的资料库、阅读、分类和检索模块，并清楚报告真实同步的阻塞点；不要用静态假数据声称端到端功能完成。


文章库浏览优化：顶部介绍改为紧凑标题区，增加独立搜索输入；列表默认按收藏关系的最后同步检查时间倒序排列，没有同步来源的本地导入使用更新时间。标题排序由服务端在分页前执行。文章库和话题汇总共用分页组件，支持每页条数下拉（分页大小）、当前页/总页数显示、页码、上一页/下一页及输入跳转。

同步排序修复：contents 持久化 last_synced_at 和规范化为 UTC 的 collected_at；同一任务内统一同步时间，先按同步时间、再按真实收藏时间倒序排序，避免内部 ID 与下载顺序把最新收藏排到后页。旧资料库从收藏关系、任务时间及 metadata.json 一次性迁移。

阅读页支持通过顶部按钮收起和展开文章信息，收起后正文使用更宽的单列布局；按钮同步提供 aria-expanded 状态，隐藏信息区不参与键盘焦点导航。

文章删除：卡片、列表和阅读页顶部提供确认删除入口，阅读页删除成功后返回文章库；删除本地文章目录、全文搜索及数据库关联，并持久化删除记录。增量/全量同步在正文请求前跳过已删除条目，写入前再次检查并与删除串行。覆盖文件清理、缺失文件、权限错误、越界/符号链接、重复删除、跨收藏夹同步及转换中删除的测试位于 backend/tests/test_content_deletion.py。
