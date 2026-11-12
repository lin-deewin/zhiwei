export interface Content {
  id: string
  kind: string
  title: string
  author?: string | null
  url?: string | null
  markdown_path: string
  excerpt: string
  category_id?: number | null
  category_name?: string | null
  category_parent_name?: string | null
  classification_source?: string
  classification_locked?: number | boolean
  classification_reason?: string
  classified_content_hash?: string | null
  updated_at: string
  last_synced_at?: string
  markdown?: string
  file_missing?: boolean
  folders?: { id: string; name: string; url?: string | null }[]
  question?: { id: string; title: string; url: string } | null
}

export interface Category {
  id: number
  parent_id?: number | null
  name: string
  article_count: number
}

export interface LibrarySettings {
  library_dir: string
  content_count: number
  zhihu_status: string
  ai_configured: boolean
  ai_base_url?: string
  ai_chat_model?: string
  ai_embedding_model?: string
  ai_api_key_set?: boolean
}

export interface PageResult {
  items: Content[]
  total: number
  page: number
  page_size: number
}

export interface ZhihuFolder {
  id: string
  name: string
  url?: string | null
  article_count: number
  scan_status: string
}

export interface SyncJob {
  id: string
  mode: 'full' | 'incremental'
  status: string
  phase: string
  folder_ids?: string
  total: number | null
  scanned: number
  downloaded: number
  failed: number
  message?: string | null
  updated_at: string
}

export interface ClassificationJob {
  id: string
  scope: string
  status: string
  total: number
  processed: number
  classified: number
  pending: number
  skipped: number
  failed: number
  error_summary?: string | null
  cancel_requested?: number
  created_at: string
  updated_at: string
}

export interface Question {
  id: string
  title: string
  url: string
  category_id: number | null
  category_name?: string | null
  category_parent_name?: string | null
  classification_source: string
  classification_locked: number
  classification_reason: string
  answer_count: number
  article_count: number
  contents?: { id: string; kind: string; title: string; author?: string | null; excerpt: string; link_source: string }[]
}

export interface QuestionJob {
  id: string
  status: string
  total: number
  processed: number
  classified: number
  pending: number
  failed: number
  error_summary: string
  items?: { question_id: string; reason: string }[]
}

export interface QuestionOverview {
  organize_questions: number
  organize_articles: number
  categories: { id: number; parent_id: number | null; name: string; question_count: number }[]
  total: number
  pending: number
}
