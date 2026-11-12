# Zhiwei V3 领域边界与数据模型

## 1. 领域边界

### Library（外部资料）
职责：外部内容、收藏来源、同步、分类、搜索投影。
实体：Content/Article/Answer、Collection、CollectionItem、Asset、Category。

### Reading（阅读行为）
职责：阅读位置、阅读状态、高亮、批注。
实体：ReadingProgress、Highlight、Annotation、ContentRevision。
阅读行为属于用户，不写入远端原始文章 Markdown。

### PersonalKnowledge（个人知识）
职责：用户自主创作和知识组织。
实体：Note、KnowledgeCard、TopicPage、KnowledgeLink、NoteRevision。
笔记可以引用多个来源；来源关系不意味着强制建立双向链接。

### AI（智能辅助）
职责：单篇阅读任务、跨资料检索、Embedding、引用校验。
实体：AIJob、AIResult、Citation、IndexDocument/Chunk。
AIResult 必须记录输入正文版本、模型配置指纹、提示词版本及实际证据快照。

### Research（持续研究）
职责：研究问题、证据集合、对话和成果。
实体：ResearchProject、EvidenceSet、EvidenceSnapshot、ResearchConversation、ResearchDocument、ResearchRevision。

## 2. 关系约束

- 一个外部 Content 可有多个 CollectionItem（多收藏夹来源）。
- 一个 Content 可有多个 Highlight/Annotation，且标注绑定正文版本。
- 一个 Content 可被多个 Note 引用。
- Note 与 Note 的链接为显式关系，可生成反向链接视图。
- TopicPage 可引用 Content、Note、KnowledgeCard。
- AIResult 引用的 Citation 必须属于本次任务实际输入证据。
- Research EvidenceSnapshot 不因当前资料更新而被静默改写。

## 3. 不变量

1. 外部 Content 与用户 Note 永远是不同实体类型。
2. 删除 Note 不删除其引用的 Content。
3. 删除 Content 前必须执行现有引用/研究快照策略，不得级联删除独立个人笔记。
4. 用户编辑过的 Markdown 不得被同步静默覆盖。
5. 正文版本更新不覆盖原始标注锚点和 AI 历史引用。
6. 文章与文章之间不自动建立 KnowledgeLink。
7. 无 Note、无标签、无链接是有效状态。
8. AI 未配置不影响本地阅读和关键词搜索。

## 4. 迁移原则

本次优先采用逻辑领域拆分，不立即按领域拆分物理数据库。现有 SQLite 表作为兼容存储，先通过服务边界、类型和 API 适配层明确职责。仅当审计发现实体语义冲突时才增加迁移。

任何 schema 变更必须：
- 新增带版本号的迁移。
- 先备份数据库。
- 支持旧版本数据读取或提供明确迁移脚本。
- 为空库、当前生产库和旧版本库分别测试。
- 记录行数、稳定 ID、外键和文件哈希对比。
- 提供失败恢复和回滚说明。

禁止为满足新名词而无必要地复制文章、迁移文章目录或重建稳定 ID。
