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
