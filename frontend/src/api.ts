import type { AskResult, Category, ClassificationJob, Content, LibrarySettings, PageResult, SyncJob, ZhihuFolder, Question, QuestionJob } from './types'

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
  const response = await fetch(`/api/v1${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = typeof body?.detail === 'string' ? body.detail : body?.detail?.message
    throw new Error(message || `请求失败 (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
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
  contents: (q = '', categoryId?: number, page = 1, pendingOnly = false, pageSize = 24, sort = 'synced') => {
    const params = new URLSearchParams({ q, page: String(page), page_size: String(pageSize), sort })
    if (categoryId) params.set('category_id', String(categoryId))
    if (pendingOnly) params.set('pending_only', 'true')
    return request<PageResult>(`/contents?${params}`)
  },
  content: (id: string) => request<Content>(`/contents/${encodeURIComponent(id)}`),
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
  ask: (question: string, categoryId?: number) => request<AskResult>('/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, category_id: categoryId }),
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
  questions: (q = '', categoryId?: number, pendingOnly = false, page = 1, pageSize = 20) => {
    const params = new URLSearchParams({ q, page: String(page), page_size: String(pageSize) })
    if (categoryId) params.set('category_id', String(categoryId))
    if (pendingOnly) params.set('pending_only', 'true')
    return request<{ items: Question[]; total: number; page: number; page_size: number }>(`/questions?${params}`)
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
  classificationJobs: () => request<ClassificationJob[]>('/classification-jobs'),
  startClassification: () => request<ClassificationJob>('/classification-jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'pending' }),
  }),
  cancelClassification: (id: string) => request<ClassificationJob>(`/classification-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  retryClassification: (id: string) => request<ClassificationJob>(`/classification-jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
}
