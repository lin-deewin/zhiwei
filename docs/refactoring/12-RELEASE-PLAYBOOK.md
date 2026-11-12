# V3 发布验收与回滚手册

日期：2026-11-12
候选分支：`refactor/v3`
目标分支：`main`
原则：先测试副本，再进行人工验收；不得在生产库上进行首次迁移试验。

## 1. 当前自动化门槛

- GitHub Actions `v3-quality.yml`：TypeScript 类型检查、前端生产构建、生产 npm 依赖高危公告检查、后端完整 pytest。
- GitHub Actions `v3-browser-smoke.yml`：使用全新的合成资料库启动真实 FastAPI + Vite 构建产物，通过 Playwright Chromium 对桌面（1440×900）和窄屏（390×844）进行基本交互、自动保存、刷新恢复、页面溢出检查，并上传截图。
- `backend/tests/test_schema_migrations.py`：空库、旧库升级、版本历史回填、幂等迁移、升级前 SQLite 快照验证。
- `backend/tests/test_backup_restore.py`：使用 SQLite backup API 创建一致性快照，验证文件清单/SHA-256、拒绝路径越界、恢复到新目录。
- `backend/tests/test_release_check.py`：只读比较备份恢复前后的稳定记录 ID、文章文件哈希与 SQLite 外键一致性。

自动化可以发现回归，但不代表生产数据、副本、大资料库性能或完整视觉体验已验收。

## 2. 生产资料库升级前

1. 停止同步、批量导入和正在进行的 AI 作业；记录应用版本与资料库路径。
2. 保证磁盘有足够空间容纳完整资料库备份和一个恢复副本。
3. 从 `backend/` 目录执行全库备份：

```bash
python -m app.backup_cli backup \
  --source "/path/to/your-library" \
  --destination "/path/to/backups/library-before-v3"
python -m app.backup_cli verify --backup "/path/to/backups/library-before-v3"
python -m app.backup_cli restore \
  --backup "/path/to/backups/library-before-v3" \
  --destination "/path/to/library-v3-rehearsal"
```

4. 对恢复副本运行升级程序。启动前设置 `ZHILIB_LIBRARY_DIR=/path/to/library-v3-rehearsal`，**不得**指向生产目录。
5. 升级前后调用只读检查器：

```bash
python -m app.release_check snapshot --library "/path/to/your-library"
python -m app.release_check compare \
  --baseline "/path/to/your-library" \
  --candidate "/path/to/library-v3-rehearsal"
```

**注意：** 升级程序还会在 `app-data/backups/` 自动生成 SQLite 迁移前快照。这是额外的数据库保护，不代替上面的完整文件和数据库备份。

## 3. 必须人工完成的验收

| 范围 | 最低验收条件 |
|---|---|
| 阅读 | 打开多篇旧文章，验证阅读位置、刷新恢复、正文版本变更后的定位 |
| 批注 | 高亮、批注、删除、重新定位，跨版本标注不丢失 |
| 独立笔记 | 新建、编辑、自动保存、标签、批量删除、版本恢复、来源引用及双向链接 |
| 研究与 AI | 未配置模型的降级提示、配置后生成、任务取消/重试/刷新恢复、引用来源正确 |
| 同步 | 取消/重试、任务重启恢复、Markdown 冲突预览和个人笔记跨库恢复 |
| 视觉 | 1440px 桌面、390px 手机布局，无遮挡、无横向滚动、按钮可触达、键盘聚焦可见 |
| 数据 | 内容/标注/个人笔记数量和稳定 ID 不减少；文章 Markdown 与附件 SHA-256 未意外改变 |
| 远程安全 | API 端口不直接暴露公网；认证由可信反向代理或 VPN 负责；CORS 不能当作认证 |

不通过任一 P0 项时，不得合并到 `main`。

## 4. 回滚策略

1. 立即停止候选版本，保留错误日志和本地资料备份，不直接删除或覆盖现场。
2. 切换应用代码回已知稳定提交；旧代码可能无法兼容升级后的数据库 schema，**不能**直接接回已升级的生产库。
3. 使用已验证的全量备份恢复到全新目录。运行 `release_check compare`，核对记录 ID 与文件哈希。
4. 在用户明确批准后，由运维修改配置指向恢复后的目录，再启动原版本。
5. 确认 API 健康、文章阅读、同步状态和关键记录一致，最后处理失败原因。

## 5. 性能基线（隔离执行）

性能基准工具：`backend/app/performance_check.py`。它不连接生产库；传入 `--library` 时，会先使用 SQLite backup API 和文件校验创建临时副本，然后只在副本上执行查询。未传入资料库时，默认生成 1,000 篇合成 Markdown 文章。

从仓库的 `backend/` 目录运行：

```bash
# 合成 1,000 篇文章，重复测量 10 次
python -m app.performance_check --iterations 10

# 对脱敏资料库副本测量（原始资料库不会被应用服务打开）
python -m app.performance_check --library "/path/to/deidentified-library" --iterations 20
```

输出仅包含数据规模、命中数量、正文字符数、P50/P95/最大延迟和备份校验摘要，不输出文章标题、ID 或正文。至少记录首屏列表、全文搜索、文章读取和关键词知识检索四项指标；对比优化前后时应使用相同机器、Python/SQLite 版本、资料库副本和查询词。当前自动化仅验证合成数据上的工具行为，不能替代 1,000 篇以上真实脱敏副本的实测。

## 6. PR 门槛

- [ ] 前后端完整 CI 成功且无未解释的高危生产依赖公告
- [ ] Playwright 浏览器测试成功并复核截图
- [ ] 生产脱敏副本上的迁移、完整备份恢复和 ID/hash 比较通过
- [ ] 原数据不丢失：来源、阅读标注、个人笔记、研究证据、Markdown 关系均可回溯
- [ ] 实际部署和回滚预演在独立环境完成
- [ ] 大资料库性能无显著回退
- [ ] 更新用户操作指南、已知限制和变更日志
- [ ] 创建 PR 后由用户确认合并与生产上线

以上未完成前，PR 应保持草稿状态，`main` 和现有部署继续不变。
