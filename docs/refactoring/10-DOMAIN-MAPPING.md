# E2-01 现有数据表与 V3 领域映射

日期：2026-11-12
基准：`backend/app/core/database.py` 当前 SCHEMA；仅描述现有实现，不把目标实体误写为已经存在。

## 1. 领域映射总览

| V3 领域 | 现有表 | 现有职责 | 目标边界 |
|---|---|---|---|
| Library | `contents`, `deleted_contents`, `categories`, `folders`, `folder_contents` | 外部文章/回答、同步排除、分类、收藏夹及收藏关系 | 外部来源只读内容模型；本地元数据和来源关系独立 |
| Library / Sync | `sync_jobs`, `classification_jobs`, `classification_job_items` | 同步与分类任务状态、逐项处理结果 | 后台任务不依赖前端页面生命周期 |
| Library / Questions | `questions`, `question_contents`, `question_classification_jobs`, `question_classification_job_items` | 知乎问题与收藏回答/关联文章、问题分类任务 | 问题是来源聚合视图，不与文章/笔记混为同一实体 |
| Reading | `reading_library_meta`, `content_revisions`, `reading_content_state` | 资料库稳定 ID、正文版本快照、当前版本与 generation | 阅读行为绑定来源内容和正文版本 |
| Reading | `annotations` | 高亮、批注、锚点状态与版本重定位 | 标注独立于正文文件，必须保留原始锚点和版本 |
| Reading | `notes` | **当前是单篇文章下的阅读笔记**，带 content_id、revision 和可选 AI 来源 | 不等于独立的个人知识笔记；不可直接作为 V3 PersonalNote 目标模型 |
| Reading / AI | `reading_ai_jobs`, `reading_ai_job_steps`, `reading_ai_results` | 单篇阅读 AI 任务、步骤、结果和正文版本约束 | AI 任务和结果保留输入版本、提示词/配置指纹、证据快照 |
| Reading / Import | `reading_requests`, `reading_import_items`, `reading_migrations` | 幂等请求、导入 ID 映射和阅读迁移记录 | 写操作保持幂等；导入必须可预览、可冲突处理 |
| PersonalKnowledge | `knowledge_topics`, `topic_drafts`, `knowledge_links` | 主题页、主题草稿和显式知识链接 | 主题页不是通用笔记；链接仅用于用户明确建立的个人知识关系 |
| Research | `research_notes`, `research_versions`, `research_projects`, `research_turns`, `project_notes` | 研究成果、版本、项目、对话轮次和成果关联 | 研究证据集应可追溯、不可被当前资料静默改写 |
| AI Retrieval | `semantic_vectors`, `semantic_jobs`, `retrieval_cases` | 向量、索引任务和检索评测案例 | 检索索引是可重建投影，不是原始资料事实源 |
| Markdown Interop | `markdown_sync_files` | 外部 Markdown 文件与内部 source ID / hash 映射 | 文件同步必须使用 hash、冲突预览和原子写入 |
| Platform | `schema_version` | 当前数据库 schema 版本占位 | 需要完善为可递增、可审计的 migration registry |

## 2. 当前实现中必须明确的概念差异

### 2.1 外部资料与阅读记录

- `contents` 是从知乎或本地 Markdown 导入的外部资料。
- `content_revisions` 保存正文版本快照。
- `annotations` 保存高亮和批注。
- `notes` 保存挂在某篇 content 下的阅读笔记。
- 删除 content 时，当前数据库外键和服务实现会清理其 revisions、annotations、notes、reading AI jobs/results 等文章级数据。

因此，当前 `notes` 是文章级阅读记录，不是可以独立存在、引用多篇文章的通用个人笔记。

### 2.2 独立个人知识实体尚不存在

现有 schema 中：
- `knowledge_topics` 是主题知识页；
- `research_notes` 是研究输出；
- `notes` 是文章级阅读笔记。

当前没有一个通用的、可脱离单篇文章存在的 Personal Note 表，也没有正式的多来源引用关系表。V3 E4 需要在确认用户体验和迁移策略后设计这类实体，不应把上述三类记录强行混为一类。

### 2.3 双向链接策略

`knowledge_links` 当前保存显式的 `from_id`、`to_id` 和 label，关系通过稳定字符串 ID 关联，不依赖文章内容自动生成。

V3 规则：
1. 不为外部文章之间自动创建双向链接。
2. 阅读高亮、批注和文章级阅读笔记不默认展示知识图谱编辑器。
3. 未来独立个人笔记和主题页可显式建立链接。
4. 反向链接是正向显式链接的派生视图，不另存一份可能失真的数据。

## 3. 重要外键与删除语义

| 关系 | 当前语义 |
|---|---|
| `contents.category_id → categories.id` | 删除分类后内容分类置空 |
| `folder_contents.folder_id → folders.id` | 删除收藏夹时移除收藏关系 |
| `folder_contents.content_id → contents.id` | 删除内容时移除收藏关系 |
| `classification_job_items → jobs/contents` | 删除任务或内容时清理逐项状态 |
| `question_contents → questions/contents` | 删除问题或内容时清理关联 |
| `content_revisions.content_id → contents.id` | 删除内容会级联清理正文版本 |
| `annotations.content_id → contents.id` | 删除内容会级联清理该文章的标注 |
| `annotations.(content_id, revision_id) → content_revisions` | 原始/当前锚点绑定正文版本 |
| `notes.content_id → contents.id` | 删除内容会级联清理该文章级阅读笔记 |
| `reading_ai_jobs/results → contents/revisions` | AI 任务和结果绑定内容及正文版本 |
| `research_versions.note_id → research_notes.id` | 删除研究笔记会清理其版本 |
| `research_turns.project_id → research_projects.id` | 删除研究项目会清理其对话轮次 |
| `project_notes → research_projects/research_notes` | 项目与研究成果的关联表 |

## 4. V3 目标逻辑实体

以下是目标边界，不表示已经创建对应数据库表：

- `ExternalContent`：知乎文章、回答或本地导入内容。
- `Collection` / `CollectionItem`：外部收藏夹及内容归属。
- `ContentRevision`：不可变正文版本。
- `ReadingProgress`：用户阅读位置和阅读状态。
- `Highlight` / `Annotation`：独立标注与批注。
- `ReadingNote`：针对单篇文章的阅读笔记。
- `PersonalNote`：独立的用户创作，可引用多个外部来源。
- `KnowledgeLink`：用户明确建立的个人知识链接。
- `TopicPage`：主题知识页。
- `AIJob` / `AIResult` / `Citation`：带正文版本和证据快照的 AI 产物。
- `ResearchProject` / `EvidenceSnapshot` / `ResearchRevision`：持续研究工作区。

## 5. 迁移策略

1. 先保持现有物理表和 API 稳定，使用领域类型与服务边界完成逻辑拆分。
2. 不把文章级 `notes` 直接重命名为独立 `PersonalNote`。
3. 独立个人笔记实体应使用新的稳定 ID，并支持零个或多个来源引用。
4. 文章级阅读笔记可继续留在阅读器中，必要时可由用户主动转为独立个人笔记；转存必须是显式操作，不能自动复制或改变现有数据。
5. 任何新增表都必须通过空库、旧库、重复执行迁移和失败回滚测试。
6. 删除外部文章时，不得删除独立个人笔记；只清理文章自身的阅读记录，并将个人笔记的来源引用标记为不可用。

## 6. 当前落地状态

- [x] 36 张现有表完成领域归类。
- [x] 确认 `notes` 是文章级阅读笔记，而非独立个人笔记。
- [x] V3 阅读器中移除知识图谱编辑器，避免对外部文章和文章级阅读记录强推双向链接。
- [ ] 独立 `PersonalNote` 实体及多来源引用的产品原型。
- [ ] API DTO、服务边界和 migration registry。
- [ ] 数据副本上的迁移与删除完整性测试。
