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
export interface KnowledgeTopic { id: string; title: string; body_md: string; revision: number; sources: EvidenceSource[] }

export interface ResearchProject {
  id: string; title: string; question: string; revision: number; evidence: EvidenceSource[]
  turns: { id: string; question: string; answer: string; sources: EvidenceSource[]; created_at: string }[]
  notes: { id: string; title: string; status: string }[]
}
