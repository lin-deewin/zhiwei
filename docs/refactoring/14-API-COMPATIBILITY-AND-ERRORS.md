# API v1 兼容策略与错误语义

> 目标：在 V3 持续重构时保留现有前端、脚本与第三方客户端可依赖的 API 契约。当前代码仍存在历史错误体格式差异；本文先建立兼容规则，不通过一次性改写破坏旧调用方。

## 1. 版本与路由原则

1. 当前稳定前缀为 **/api/v1**。非破坏性增加字段、可选参数和新路由可在 v1 内演进。
2. 不得直接删除或重命名已有路径/HTTP method；替换接口时先提供新路由，旧路由保留兼容适配层。
3. 新接口必须有明确 Pydantic Request DTO、字段长度/数量/枚举约束，并尽可能定义 response_model。
4. 对已有接口改变字段语义、默认值、分页行为或删除策略属于破坏性变更，需新版本或双轨兼容。
5. URL query 与前端共享链接应保持向后兼容；旧 /ask、同步任务、阅读接口保留至迁移完成。
6. API 路由只做 HTTP 校验/错误映射；业务规则和事务由 service 层负责。

## 2. 统一 HTTP 状态码

| 状态码 | 含义 | 典型场景 |
|---:|---|---|
| 200 | 成功读取/更新 | 查询、PATCH、取消任务 |
| 201 | 资源已创建 | 创建个人笔记、主题、研究项目 |
| 202 | 后台任务已接受 | 同步、分类、语义索引、研究任务 |
| 204 | 成功且无响应正文 | 删除资源 |
| 400 | 输入语义不合法 | 来源类型不一致、超过领域限制 |
| 401 | 未认证 | 需要用户身份的远端账号接口 |
| 403 | 已认证但无权限 | 账号/资料库权限不足 |
| 404 | 资源不存在 | 文章、笔记、项目或任务 ID 不存在 |
| 409 | 并发冲突/状态冲突 | revision 过期、任务不可重复启动 |
| 413 | 请求体过大 | 上传文件超过服务限制 |
| 422 | DTO 结构或字段校验失败 | Pydantic Field 约束失败 |
| 429 | 请求过于频繁 | 外部模型或服务限流 |
| 502 | 上游依赖失败 | AI provider 返回错误或响应格式无效 |
| 503 | 当前服务不可用 | 未配置模型、依赖尚未就绪 |
| 504 | 上游超时 | 模型服务超时 |

## 3. 错误响应兼容规则

### 3.1 当前兼容格式

历史 API 可能返回：
- detail: "可读错误文本"
- detail: { "code": "ERROR_CODE", "message": "可读错误文本" }
- FastAPI/Pydantic 的 detail: [{loc, msg, type, ...}]

现有客户端必须兼容上述三种形态。迁移期间不要把历史 string detail 强制改为对象，以免破坏现有错误解析。

### 3.2 新接口标准

新建或重大重构的 endpoint 统一返回：

~~~json
{
  "detail": {
    "code": "RESOURCE_CONFLICT",
    "message": "资源已在其他位置修改，请刷新后重试",
    "retryable": false,
    "request_id": "可选的追踪 ID"
  }
}
~~~

约束：
- code 使用稳定、机器可读的英文大写错误码；不包含供应商原始错误。
- message 面向用户，中文简洁，说明下一步动作。
- retryable 仅在服务端能明确判断时提供；不得把所有 5xx 都标成可重试。
- 不返回 API Key、Cookie、完整上游响应、堆栈、私人正文或本地绝对路径。
- 409 表示状态/版本冲突；不能通过盲目重试覆盖用户新内容。

## 4. 并发、幂等与后台任务

- 可编辑领域对象使用 revision 乐观锁；更新必须同时检查 revision 并原子递增。
- 创建型重试使用 request_key 或稳定幂等键，避免网络重试产生重复资源。
- 后台任务使用 202 + job_id，并提供 GET 状态、取消、重试（如业务允许）和服务重启恢复策略。
- 任务状态至少区分 queued/pending、running、completed、failed、cancelled、interrupted；不要把 cancelled 误记为 failed。
- 研究任务绑定创建时的 project revision；证据/项目已变化时应返回冲突或要求刷新。
- 删除/批量操作先验证全部 revision，再在单一事务中执行；不得出现部分成功而响应整体失败。

## 5. DTO 与响应模型

- Request DTO：按业务域放在对应 router 模块，字段约束靠近入口；不要使用无约束的裸 dict 替代已有 DTO。
- Response DTO：新接口优先使用 Pydantic model / response_model，确保 OpenAPI 可发现字段、nullable、状态值和分页结构。
- 兼容性新增字段必须 optional 或有默认值；字段重命名需在迁移窗口同时输出旧字段和新字段。
- 列表接口统一分页参数 page>=1、page_size=1..100（特殊接口须在文档说明）。
- 多态来源 ID 统一格式 {source_type}:{stable_id}；service 层验证来源类型、目标存在性和是否允许自引用。

## 6. 自动化契约门槛

- backend/tests/test_api_contract.py 固定关键 v1 路径与 HTTP methods，防止重构时意外删除。
- 对关键 DTO 验证 OpenAPI schema 存在。
- 每个领域新增/修改错误映射时，补充 HTTP status + error code + 不泄露内部错误的测试。
- 后续可将 OpenAPI JSON 规范化后做 snapshot diff；任何 breaking diff 必须人工审查。
- 旧路由拆分到新 router 时只改变 Python 文件归属，不改变 URL、method、响应语义。

## 7. 当前待治理项

1. api.routes.py 仍聚合账号、资料、同步、分类、话题和 AI 问答；拆分时保持兼容。
2. 个别路由仍返回动态 dict，逐步补齐 response_model。
3. 不同 router 的 HTTPException.detail 仍有 string/object 混用；新接口按本规范，旧接口逐个迁移。
4. AI 上游错误应通过统一 translator 映射；不能直接返回供应商 payload。
5. API authentication 目前依赖部署环境/可信访问边界；CORS 不是身份认证，公网部署必须由反向代理/VPN/认证层保护。
