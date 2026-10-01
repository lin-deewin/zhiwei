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

export interface ReadingBlock {
  id: string; kind: string; heading_path: string[]; text: string; text_hash: string; markable: boolean
}
export interface TextAnchor {
  revision_id: string; normalization_version: number; block_id: string; start: number; end: number
  exact: string; prefix: string; suffix: string; block_hash: string; heading_path: string[]
}
export interface Annotation {
  id: string; content_id: string; original_anchor: TextAnchor; current_anchor: TextAnchor | null
  anchor_status: 'resolved' | 'ambiguous' | 'orphaned' | 'pending'; color: 'yellow' | 'green' | 'blue'
  comment_md: string; revision: number; created_at: string; updated_at: string
}
export interface PersonalNote {
  id: string; content_id: string; title: string; body_md: string; revision: number
  created_at: string; updated_at: string; origin_ai_result_id?: string | null
}
export interface ReadingAIJob {
  id: string; status: string; stage: string; completed_steps: number; total_steps: number
  error_code?: string | null; error_message?: string | null; result_id?: string | null
}
export interface ReadingAIResult {
  id: string; content_id: string; revision_id: string; action: string; rendered_md: string
  result_json: string; citations_json: string; created_at: string
}
export interface ReadingContext {
  library_id: string; content_id: string; revision_id: string | null; body_hash: string | null
  normalization_version: number; markdown: string; blocks: ReadingBlock[]; file_missing: boolean
  annotations: Annotation[]; notes: PersonalNote[]; ai_results: ReadingAIResult[]
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

export type EvidenceKind = 'article' | 'note' | 'annotation' | 'research' | 'topic'
export interface EvidenceSource {
  citation_id?: string
  chunk_id: string
  source_id: string
  source_type: EvidenceKind
  match_methods?: string[]
  url?: string | null
  markdown_path?: string
  record_id: string
  content_id: string | null
  title: string
  article_title?: string
  heading: string
  text: string
  score: number
  content_hash: string
  excerpted?: boolean
  updated_at: string
}
export interface AskResult {
  answer: string
  retrieval: string
  sources: EvidenceSource[]
}
export interface ResearchNote {
  id: string
  title: string
  question: string
  body_md: string
  sources: EvidenceSource[]
  revision: number
  status: 'draft' | 'saved'
  updated_at: string
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

export interface KnowledgeTopic { id: string; title: string; body_md: string; revision: number; sources: EvidenceSource[] }

export interface ResearchProject {
  id: string; title: string; question: string; revision: number; evidence: EvidenceSource[]
  turns: { id: string; question: string; answer: string; sources: EvidenceSource[]; created_at: string }[]
  notes: { id: string; title: string; status: string }[]
}
