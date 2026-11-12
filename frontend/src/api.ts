import { newRequestKey } from './utils/request_key'
import type { Annotation, AskResult, Category, ClassificationJob, Content, LibrarySettings, PageResult, SyncJob, ZhihuFolder, Question, QuestionJob, PersonalNote, PersonalKnowledgeNote, PersonalKnowledgeNoteListItem, PersonalNoteVersionSummary, PersonalNoteVersion, ReadingContext, ReadingAIJob, ReadingAIResult, ReadingProgress, ReadingListItem } from './types'

export type AccountStatus = { status: string; message: string; profile?: { name: string } | null }
export type LoginStatus = {
  login_id: string | null
  control_token?: string
  state: string
  revision: number
  message: string
  expires_at: number
  frame_mode: 'qr' | 'page'
  can_refresh: boolean
}
export type LoginFrame = {
  frame_id: number
  image_data_url: string
  frame_mode: 'qr' | 'page'
  viewport_width: number
  viewport_height: number
}
export type LoginEvent = { type: string; x?: number; y?: number; delta?: number; key?: string; value?: string }

const loginHeaders = (token: string) => ({ 'X-Zhilib-Login-Token': token })

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const modelRequest = path === '/ask' || path === '/research-notes' || path.endsWith('/draft') || path.endsWith('/ask') || path.endsWith('/research') || path === '/knowledge/evaluate'
  const timeout = window.setTimeout(() => controller.abort(), modelRequest && init?.method === 'POST' ? 400000 : init?.method && init.method !== 'GET' ? 150000 : 20000)
  const abort = () => controller.abort(init?.signal?.reason)
  if (init?.signal?.aborted) abort()
  else init?.signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(`/api/v1${path}`, { ...init, signal: controller.signal })
    if (response.status === 204) return undefined as T
    const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || ''
    if (mediaType !== 'application/json' && !mediaType.endsWith('+json')) {
      throw new Error(`接口返回了非 JSON 内容（${response.status}），请确认后端已更新并重启，且接口请求正确转发到后端。`)
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const message = typeof body?.detail === 'string' ? body.detail : body?.detail?.message
      throw new Error(message || `请求失败 (${response.status})`)
    }
    try {
      return await response.json() as T
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('接口返回的数据格式错误，请检查后端服务状态。')
      throw error
    }
  } catch (error) {
    if (controller.signal.aborted && !init?.signal?.aborted) {
      throw new Error('请求超时，请检查本地服务状态；提交的操作可能仍在执行，请刷新状态后再重试。')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', abort)
  }
}

export const api = {
  account: () => request<AccountStatus>('/account'),
  startBrowserLogin: (requestId: string) => request<LoginStatus>('/account/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId }),
  }),
  browserLoginStatus: (id: string, token: string) => request<LoginStatus>(
    `/account/login/${encodeURIComponent(id)}`, { headers: loginHeaders(token) }),
  browserLoginFrame: (id: string, token: string) => request<LoginFrame>(
    `/account/login/${encodeURIComponent(id)}/frame`, { headers: loginHeaders(token) }),
  browserLoginInput: (id: string, token: string, frameId: number, events: LoginEvent[]) => request<LoginStatus>(
    `/account/login/${encodeURIComponent(id)}/input`, { method: 'POST', headers: {
      ...loginHeaders(token), 'Content-Type': 'application/json',
    }, body: JSON.stringify({ frame_id: frameId, events }) }),
  refreshBrowserLogin: (id: string, token: string) => request<LoginStatus>(
    `/account/login/${encodeURIComponent(id)}/refresh`, { method: 'POST', headers: loginHeaders(token) }),
  cancelBrowserLogin: (id: string, token: string) => request<LoginStatus>(
    `/account/login/${encodeURIComponent(id)}`, { method: 'DELETE', headers: loginHeaders(token) }),
  connectAccount: () => request<AccountStatus>('/account/connect', { method: 'POST' }),
  verifyAccount: () => request<AccountStatus>('/account/verify', { method: 'POST' }),
  disconnectAccount: () => request<AccountStatus>('/account/disconnect', { method: 'POST' }),
  startQrLogin: () => request<AccountStatus & { qr_data_url: string }>('/account/qr/start', { method: 'POST' }),
  pollQrLogin: () => request<AccountStatus>('/account/qr/poll', { method: 'POST' }),
  contents: (q = '', categoryId?: number, page = 1, pendingOnly = false, pageSize = 24, sort = 'synced', signal?: AbortSignal, source = 'all') => {
    const params = new URLSearchParams({ q, page: String(page), page_size: String(pageSize), sort, source })
    if (categoryId) params.set('category_id', String(categoryId))
    if (pendingOnly) params.set('pending_only', 'true')
    return request<PageResult>(`/contents?${params}`, { signal })
  },
  content: (id: string) => request<Content>(`/contents/${encodeURIComponent(id)}`),
  readingContext: (id: string) => request<ReadingContext>(`/contents/${encodeURIComponent(id)}/reading-context`),
  readingProgress: (id: string) => request<ReadingProgress>(`/contents/${encodeURIComponent(id)}/reading-progress`),
  saveReadingProgress: (id: string, value: { progress_ratio: number; scroll_y: number; block_id?: string | null }, keepalive = false) => request<ReadingProgress>(`/contents/${encodeURIComponent(id)}/reading-progress`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), keepalive }),
  setReadLater: (id: string, enabled: boolean) => request<ReadingProgress>(`/contents/${encodeURIComponent(id)}/read-later`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }),
  recentlyRead: (limit = 50) => request<ReadingListItem[]>(`/reading/recent?limit=${limit}`),
  readLater: (limit = 50) => request<ReadingListItem[]>(`/reading/later?limit=${limit}`),
  annotations: (id: string) => request<Annotation[]>(`/contents/${encodeURIComponent(id)}/annotations`),
  createAnnotation: (id: string, value: { revision_id: string; anchor: object; color: string; comment_md: string; request_key: string }) => request<Annotation>(`/contents/${encodeURIComponent(id)}/annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
  patchAnnotation: (id: string, value: { revision: number; color?: string; comment_md?: string }) => request<Annotation>(`/annotations/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
  deleteAnnotation: (id: string, revision: number) => request<void>(`/annotations/${encodeURIComponent(id)}?revision=${revision}`, { method: 'DELETE' }),
  reanchorAnnotation: (id: string, value: { revision: number; revision_id: string; anchor: object }) => request<Annotation>(`/annotations/${encodeURIComponent(id)}/reanchor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
  createNote: (id: string, value: { title: string; body_md: string; request_key: string }) => request<PersonalNote>(`/contents/${encodeURIComponent(id)}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
  patchNote: (id: string, value: { revision: number; title: string; body_md: string }) => request<PersonalNote>(`/notes/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
  deleteNote: (id: string, revision: number) => request<void>(`/notes/${encodeURIComponent(id)}?revision=${revision}`, { method: 'DELETE' }),
  searchNotes: (q = '', page = 1, pageSize = 20, includeQuotes = false) => {
    const params = new URLSearchParams({ q, page: String(page), page_size: String(pageSize), include_quotes: String(includeQuotes) })
    return request<{ items: Array<{ id: string; type: string; content_id: string; title: string; body_md: string; article_title: string; quote: string; updated_at: string; anchor_status?: string | null }>; total: number; page: number; page_size: number }>(`/notes/search?${params}`)
  },
  createReadingAIJob: (id: string, value: { action: 'summary' | 'explain' | 'key_points'; revision_id: string; selection_anchor?: object | null; force?: boolean; request_key: string }) => request<{ kind: 'job' | 'result'; id?: string; status?: string; result?: ReadingAIResult; reused?: boolean }>(`/contents/${encodeURIComponent(id)}/reading-ai-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
  readingAIJob: (id: string) => request<ReadingAIJob>(`/reading-ai-jobs/${encodeURIComponent(id)}`),
  cancelReadingAIJob: (id: string) => request<ReadingAIJob>(`/reading-ai-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  retryReadingAIJob: (id: string) => request<{ kind: string; id: string; status: string }>(`/reading-ai-jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
  readingAIResults: (id: string) => request<ReadingAIResult[]>(`/contents/${encodeURIComponent(id)}/reading-ai-results`),
  readingAIResult: (id: string) => request<ReadingAIResult>(`/reading-ai-results/${encodeURIComponent(id)}`),
  deleteReadingAIResult: (id: string) => request<void>(`/reading-ai-results/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  convertAIResultToNote: (id: string, value: { request_key: string; title: string }) => request<PersonalNote>(`/reading-ai-results/${encodeURIComponent(id)}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
  exportReadingData: (id: string) => fetch(`/api/v1/contents/${encodeURIComponent(id)}/reading-export`).then(async (response) => {
    if (!response.ok) throw new Error(`导出失败 (${response.status})`)
    return response.blob()
  }),
  previewReadingImport: (id: string, data: unknown) => request<{ export_id: string; content_id: string; revisions: number; annotations: number; notes: number; ai_results: number }>(`/contents/${encodeURIComponent(id)}/reading-imports/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  importReadingData: (id: string, data: unknown) => request<{ export_id: string; imported: { annotations: number; notes: number; ai_results: number } }>(`/contents/${encodeURIComponent(id)}/reading-imports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_key: newRequestKey(), data }) }),
  deleteContent: (id: string) => request<void>(`/contents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  categories: () => request<Category[]>('/categories'),
  createCategory: (name: string, parentId?: number) => request<Category>('/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: parentId }),
  }),
  deleteCategory: (id: number) => request<void>(`/categories/${id}`, { method: 'DELETE' }),
  classify: (id: string, categoryId: number | null) => request<Content>(
    `/contents/${encodeURIComponent(id)}/classification`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId }),
    },
  ),
  autoClassify: (id: string) => request<{ content: Content; reason: string; source: string }>(
    `/contents/${encodeURIComponent(id)}/auto-classify`, { method: 'POST' },
  ),
  settings: () => request<LibrarySettings>('/settings'),
  updateSettings: (libraryDir: string) => request<{ library_dir: string }>('/settings', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ library_dir: libraryDir }),
  }),
  updateAISettings: (values: { base_url: string; chat_model: string; embedding_model: string; api_key?: string; clear_api_key?: boolean }) => request<{ api_key_set: boolean }>('/settings/ai', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
  }),
  ask: (question: string, categoryId?: number, kinds?: import('./types').EvidenceKind[]) => request<AskResult>('/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, category_id: categoryId, kinds }),
  }),
  projects: () => request<{ items: Pick<import('./types').ResearchProject, 'id' | 'title' | 'question'>[] }>('/knowledge/projects'),
  project: (id: string) => request<import('./types').ResearchProject>(`/knowledge/projects/${encodeURIComponent(id)}`),
  createProject: (title: string, question: string, ids: string[]) => request<import('./types').ResearchProject>('/knowledge/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, question, source_ids: ids }) }),
  projectEvidence: (id: string, revision: number, ids: string[], refresh = false) => request<import('./types').ResearchProject>(`/knowledge/projects/${encodeURIComponent(id)}/evidence`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, source_ids: ids, refresh }) }),
  projectAsk: (id: string, revision: number, question: string, research = false) => request<{ project: import('./types').ResearchProject; note_id: string | null }>(`/knowledge/projects/${encodeURIComponent(id)}/${research ? 'research' : 'ask'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, question }) }),
  researchVersions: (id: string) => request<{ items: { id: string; title: string; reason: string; created_at: string }[] }>(`/knowledge/versions/${encodeURIComponent(id)}`),
  compareResearchVersion: (id: string, version: string) => request<{ version: { title: string; body_md: string }; diff: string; current_revision: number }>(`/knowledge/versions/${encodeURIComponent(id)}/${encodeURIComponent(version)}`),
  restoreResearchVersion: (id: string, version: string, revision: number) => request<import('./types').ResearchNote>(`/knowledge/versions/${encodeURIComponent(id)}/${encodeURIComponent(version)}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }) }),
  markdownConfiguration: () => request<{ directory: string; auto_sync: boolean }>('/knowledge/markdown/configuration'),
  configureMarkdown: (directory: string, autoSync: boolean) => request('/knowledge/markdown/configuration', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory, auto_sync: autoSync }) }),
  markdownPreview: () => request<{ directory: string; items: { path: string; status: string; source_id?: string; file_hash?: string; record_hash?: string; message?: string }[] }>('/knowledge/markdown/preview'),
  exportMarkdown: () => request<{ items: { path: string; status: string }[] }>('/knowledge/markdown/export', { method: 'POST' }),
  importMarkdownFiles: (paths: string[], hashes: Record<string, string>, merged?: Record<string, string>) => request<{ items: { path: string; status: string }[] }>('/knowledge/markdown/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths, expected_hashes: hashes, merged_record_hashes: merged }) }),
  resolveWikiLinks: (targets: string[]) => request<{ items: Record<string, import('./utils/knowledge_links').KnowledgeNode> }>('/knowledge/resolve-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets }) }),
  knowledgeNodes: (q = '') => request<{ items: import('./utils/knowledge_links').KnowledgeNode[] }>(`/knowledge/nodes?q=${encodeURIComponent(q)}`),
  knowledgeLinks: (sourceId: string) => request<{ node: import('./utils/knowledge_links').KnowledgeNode; outgoing: (import('./utils/knowledge_links').KnowledgeNode & { relation: string })[]; incoming: (import('./utils/knowledge_links').KnowledgeNode & { relation: string })[]; unresolved: { target: string; reason: string }[] }>(`/knowledge/links?source_id=${encodeURIComponent(sourceId)}`),
  addKnowledgeLink: (fromId: string, toId: string) => request<{ node: import('./utils/knowledge_links').KnowledgeNode; outgoing: (import('./utils/knowledge_links').KnowledgeNode & { relation: string })[]; incoming: (import('./utils/knowledge_links').KnowledgeNode & { relation: string })[]; unresolved: { target: string; reason: string }[] }>('/knowledge/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_id: fromId, to_id: toId }) }),
  deleteKnowledgeLink: (fromId: string, toId: string) => request<void>(`/knowledge/links?from_id=${encodeURIComponent(fromId)}&to_id=${encodeURIComponent(toId)}`, { method: 'DELETE' }),
  knowledgeTopics: () => request<{ items: { id: string; title: string; revision: number }[] }>('/knowledge/topics'),
  knowledgeTopic: (id: string) => request<import('./types').KnowledgeTopic>(`/knowledge/topics/${encodeURIComponent(id)}`),
  createKnowledgeTopic: (title: string) => request<import('./types').KnowledgeTopic>('/knowledge/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }),
  saveKnowledgeTopic: (id: string, title: string, body: string, revision: number, draftId?: string) => request<import('./types').KnowledgeTopic>(`/knowledge/topics/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body_md: body, revision, draft_id: draftId }) }),
  topicDraft: (id: string, sourceIds: string[]) => request<{ id: string; title: string; body_md: string; sources: import('./types').EvidenceSource[]; revision: number }>(`/knowledge/topics/${encodeURIComponent(id)}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_ids: sourceIds }) }),
  semanticStatus: () => request<{ indexed_chunks: number; default_model: string; job: { id: string; model: string; status: string; total: number; processed: number; error: string } | null }>('/knowledge/semantic'),
  startSemanticIndex: () => request<{ indexed_chunks: number; default_model: string; job: { id: string; model: string; status: string; total: number; processed: number; error: string } | null }>('/knowledge/semantic', { method: 'POST' }),
  cancelSemanticIndex: () => request<{ indexed_chunks: number; default_model: string; job: { id: string; model: string; status: string; total: number; processed: number; error: string } | null }>('/knowledge/semantic/cancel', { method: 'POST' }),
  retrievalCases: () => request<{ items: { id: string; question: string; expected_sources: string[] }[] }>('/knowledge/evaluation-cases'),
  addRetrievalCase: (question: string, expected: string[]) => request('/knowledge/evaluation-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, expected_sources: expected }) }),
  deleteRetrievalCase: (id: string) => request<void>(`/knowledge/evaluation-cases/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  evaluateRetrieval: () => request<{ k: number; summary: Record<string, { recall_at_k: number; mrr: number }> }>('/knowledge/evaluate', { method: 'POST' }),
  searchKnowledge: (question: string, categoryId: number | undefined, kinds: import('./types').EvidenceKind[]) => request<{ sources: import('./types').EvidenceSource[] }>('/knowledge/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, category_id: categoryId, kinds }),
  }),
  generateResearch: (question: string, chunkIds: string[], categoryId: number | undefined, kinds: import('./types').EvidenceKind[]) => request<import('./types').ResearchNote>('/research-notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, chunk_ids: chunkIds, category_id: categoryId, kinds }),
  }),
  researchNotes: (q = '', includeDrafts = false) => request<{ items: Pick<import('./types').ResearchNote, 'id' | 'title' | 'question' | 'status' | 'updated_at'>[] }>(`/research-notes?q=${encodeURIComponent(q)}&include_drafts=${includeDrafts}`),
  researchNote: (id: string) => request<import('./types').ResearchNote>(`/research-notes/${encodeURIComponent(id)}`),
  saveResearch: (id: string, title: string, body: string, revision?: number) => request<import('./types').ResearchNote>(`/research-notes/${encodeURIComponent(id)}/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body_md: body, revision }),
  }),
  deleteResearch: (id: string) => request<void>(`/research-notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  personalNotes: (q = '', page = 1, pageSize = 20) => request<{ items: PersonalKnowledgeNoteListItem[]; total: number; page: number; page_size: number }>(`/personal-notes?q=${encodeURIComponent(q)}&page=${page}&page_size=${pageSize}`),
  personalNote: (id: string) => request<PersonalKnowledgeNote>(`/personal-notes/${encodeURIComponent(id)}`),
  personalNoteVersions: (id: string) => request<PersonalNoteVersionSummary[]>(`/personal-notes/${encodeURIComponent(id)}/versions`),
  personalNoteVersion: (id: string, revision: number) => request<PersonalNoteVersion>(`/personal-notes/${encodeURIComponent(id)}/versions/${revision}`),
  createPersonalNote: (title = '', body = '', sourceIds: string[] = [], tags: string[] = []) => request<PersonalKnowledgeNote>('/personal-notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body_md: body, source_ids: sourceIds, tags }),
  }),
  savePersonalNote: (id: string, title: string, body: string, revision: number, sourceIds: string[], tags: string[] = []) => request<PersonalKnowledgeNote>(`/personal-notes/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body_md: body, revision, source_ids: sourceIds, tags }),
  }),
  deletePersonalNote: (id: string, revision: number) => request<void>(`/personal-notes/${encodeURIComponent(id)}?revision=${revision}`, { method: 'DELETE' }),
  bulkDeletePersonalNotes: (items: Array<{ id: string; revision: number }>) => request<{ deleted: number }>('/personal-notes/bulk-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
  }),
  importMarkdown: async (file: File) => {
    const data = new FormData()
    data.append('file', file)
    return request<Content>('/imports/markdown', { method: 'POST', body: data })
  },
  folders: () => request<ZhihuFolder[]>('/folders'),
  refreshFolders: () => request<ZhihuFolder[]>('/folders/refresh', { method: 'POST' }),
  syncJobs: () => request<SyncJob[]>('/sync-jobs'),
  startSync: (mode: 'full' | 'incremental', folderIds: string[]) => request<SyncJob>('/sync-jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, folder_ids: folderIds }),
  }),
  cancelSync: (id: string) => request<SyncJob>(`/sync-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  questionOverview: (signal?: AbortSignal) => request<import('./types').QuestionOverview>('/question-collection/overview', { signal }),
  questions: (q = '', categoryId?: number, pendingOnly = false, page = 1, pageSize = 20, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q, page: String(page), page_size: String(pageSize) })
    if (categoryId) params.set('category_id', String(categoryId))
    if (pendingOnly) params.set('pending_only', 'true')
    return request<{ items: Question[]; total: number; page: number; page_size: number }>(`/questions?${params}`, { signal })
  },
  question: (id: string) => request<Question>(`/questions/${encodeURIComponent(id)}`),
  classifyQuestion: (id: string, categoryId: number | null) => request<Question>(`/questions/${encodeURIComponent(id)}/classification`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category_id: categoryId }),
  }),
  resuggestQuestion: (id: string) => request<Question>(`/questions/${encodeURIComponent(id)}/resuggest`, { method: 'POST' }),
  attachQuestionArticle: (id: string, contentId: string) => request<Question>(`/questions/${encodeURIComponent(id)}/contents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content_id: contentId }),
  }),
  detachQuestionArticle: (id: string, contentId: string) => request<void>(`/questions/${encodeURIComponent(id)}/contents/${encodeURIComponent(contentId)}`, { method: 'DELETE' }),
  manualQuestionLink: (questionUrl: string, contentId: string) => request<Question>('/questions/manual-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_url: questionUrl, content_id: contentId }),
  }),
  backfillQuestions: () => request<{ questions: number; relations: number }>('/question-collection/backfill', { method: 'POST' }),
  questionJobs: () => request<QuestionJob[]>('/question-classification/jobs'),
  questionJob: (id: string) => request<QuestionJob>(`/question-classification/jobs/${id}`),
  startQuestionJob: () => request<QuestionJob>('/question-classification/jobs', { method: 'POST' }),
  cancelQuestionJob: (id: string) => request<QuestionJob>(`/question-classification/jobs/${id}/cancel`, { method: 'POST' }),
  retryQuestionJob: (id: string) => request<QuestionJob>(`/question-classification/jobs/${id}/retry`, { method: 'POST' }),
  classificationOverview: () => request<{ pending: number }>('/classification-jobs/overview'),
  classificationJobs: () => request<ClassificationJob[]>('/classification-jobs'),
  startClassification: () => request<ClassificationJob>('/classification-jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'pending' }),
  }),
  cancelClassification: (id: string) => request<ClassificationJob>(`/classification-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  retryClassification: (id: string) => request<ClassificationJob>(`/classification-jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
}
