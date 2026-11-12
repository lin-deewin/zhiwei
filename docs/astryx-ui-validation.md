# Astryx UI 重构验证

此次迁移保留原有路由、查询参数、API、资料目录与阅读数据结构。固定使用 Astryx 0.7.14，主题源文件位于 `frontend/src/theme/zhiwei-theme.ts`，生成产物一并提交。

## 变更范围

- 全局 AppShell、响应式 SideNav、统一主题与语义 Token。
- 官方按钮、文本输入、多行编辑、复选框、下拉、分页、页签、进度、弹窗、通知及文件变化表格。
- 资料库工具栏、知识主题目录与编辑区、阅读及笔记表单、分类、话题、同步和设置页面。
- 共享分类选择器、确认窗口、页面标题、加载与错误状态；异步未保存确认。
- 业务页面按路由加载；保留工作区标签保活及文章正文锚点。

## 自动检查

```bash
cd frontend
npm ci
npm run build
npx astryx theme build src/theme/zhiwei-theme.ts --out src/theme/zhiwei.css --check
npx astryx doctor --built dist
```

```bash
cd backend
.venv/bin/pytest -q
```

浏览器测试必须使用隔离资料库；不要连接个人资料库。分别启动：

```bash
ZHILIB_HOME=/tmp/zhiwei-astryx-qa ZHILIB_LIBRARY_DIR=/tmp/zhiwei-astryx-qa/library \
  backend/.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8010
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

安装后端可选 Playwright Chromium 后，在仓库根目录执行：

```bash
ZHILIB_UI_TEST_ALLOW_MUTATION=1 backend/.venv/bin/python frontend/tests/ui_smoke.py
```

测试会在隔离库创建文章、批注和个人笔记，并保留测试数据用于人工检查。覆盖导入、阅读选区与批注、稍后阅读、删除取消、笔记保存、主题切换，以及 14 个入口在 360、390、768、1024、1440 宽度下的页面加载与横向溢出检查。

## 验证边界

生产构建仍有大于 500 kB 的共享 JavaScript 块提示；已对业务页面分包。Astryx 的严格源码审计会提示保留的原生领域标记、图标和旧布局尺寸；构建集成检查与源码纯度审计是两项不同检查。旧样式按渐进迁移要求保留在独立层，后续清理不得破坏选区、锚点和图谱。

真实知乎扫码、安全验证、远程模型调用和生产资料同步依赖外部服务，浏览器自动测试不会提交这些真实操作；相关后端行为由现有回归测试覆盖。

## 本次执行结果（2026-11-12）

- `npm ci && npm run build`：通过，依赖审计无漏洞；存在共享块体积提示。
- 后端 Pytest：104 项通过；一条 Starlette 测试客户端弃用提示。
- 主题生成产物一致性检查：通过。
- `astryx doctor --built dist`：11 项通过，无警告、无失败；严格源码审计的保留项见上文。
- 新浏览器检查：文章导入、批注保存（核对 API 数据）、稍后阅读、删除取消、笔记保存、主题切换通过；双主题 × 5 种宽度 × 14 个入口，共 140 次加载与溢出检查通过。
- 原有浏览器回归：针对全新隔离资料库及生产构建，桌面／手机、自动保存后刷新、阅读进度、批注、阅读笔记、选区转个人笔记、显式知识链接、研究失败／重试持久化及同步页面全部通过。测试定位器已适配官方表单结构，保留原有业务断言。
- 浏览器回归工作流扩展到 `main` 和 `refactor/**` 推送。GitHub 上的执行结果需以 Actions 为准，本记录为本地验证结果。
