# E0-07 本地资料库备份与恢复

当前工具：`backend/app/core/backup.py`
命令入口：`python -m app.backup_cli`

## 1. 备份内容

工具备份整个资料库目录，包含：
- `app-data/library.sqlite`：使用 SQLite backup API 生成一致性数据库副本，不直接复制活动数据库文件。
- `articles/` 等正文、附件和本地资料文件。
- 资料库目录下其他普通文件。

SQLite 的 `-wal` 与 `-shm` sidecar 不直接复制；已提交事务由 SQLite backup API 纳入数据库副本。工具拒绝符号链接，并在复制普通文件前后校验 hash/size，检测到并发修改会中止备份。备份清单记录每个文件的 SHA-256 和字节数。

## 2. 命令

从仓库的 `backend/` 目录运行。

### 创建备份

```bash
python -m app.backup_cli backup \
  --source "/path/to/ZhihuLibrary" \
  --destination "/path/to/backups/zhihu-library-2026-11-12"
```

目标目录必须不存在，且不能位于源资料库目录内。

### 验证备份

```bash
python -m app.backup_cli verify \
  --backup "/path/to/backups/zhihu-library-2026-11-12"
```

验证会检查清单中的文件是否缺失、大小/hash 是否一致，并执行 SQLite `PRAGMA integrity_check` 和外键检查计数。

### 恢复到新目录

```bash
python -m app.backup_cli restore \
  --backup "/path/to/backups/zhihu-library-2026-11-12" \
  --destination "/path/to/ZhihuLibrary-restore-test"
```

恢复目标必须是一个不存在的新目录。恢复不会覆盖现有资料库，也不会自动切换应用正在使用的资料目录。

## 3. 安全操作流程

1. 创建备份。
2. 执行 verify，确认文件清单和 SQLite integrity check 通过。
3. 恢复到一个全新的临时目录。
4. 对恢复副本运行应用和核心流程回归测试。
5. 确认文章数量、笔记数量、标注数量、引用关系和附件均符合预期。
6. 只有在用户明确确认后，才考虑切换应用资料目录。

禁止把 restore 目标设置为正在使用的生产资料库目录。禁止在没有可验证备份的情况下执行破坏性 schema 迁移。

## 4. 自动化测试

`backend/tests/test_backup_restore.py` 覆盖：
- 数据库 + 文件备份/恢复往返。
- SHA-256 清单验证。
- 文件被篡改后的校验失败。
- 路径穿越清单拒绝。
- 目标目录已存在或位于源资料库内部时拒绝。
- 符号链接拒绝（Windows 跳过该 POSIX 特定测试）。

这些是临时测试资料库的自动化恢复演练，不代表用户生产资料库已完成实际恢复验收。

## 5. 已知限制

- 工具不复制应用配置目录中的 API Key、浏览器登录会话或系统凭据；这些凭据应使用独立、安全的配置备份策略。
- 不支持资料库内部符号链接；如果现有资料库依赖符号链接，必须先人工评估。
- 备份期间若普通资料文件被修改，工具会中止；推荐在同步任务停止、没有批量导入时执行。
- 外键检查结果目前作为报告计数返回，不会自动修复旧库中的孤儿记录。
