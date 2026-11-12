import type { EvidenceSource } from '../types'
export type KnowledgeNode = Pick<EvidenceSource, 'source_id' | 'record_id' | 'source_type' | 'content_id' | 'title'>
export function nodePath(node: KnowledgeNode) {
  if (node.source_type === 'topic') return `/knowledge?topic=${encodeURIComponent(node.record_id)}`
  if (node.source_type === 'research') return `/ask?research=${encodeURIComponent(node.record_id)}`
  if (node.source_type === 'personal_note') return `/personal-notes?note=${encodeURIComponent(node.record_id)}`
  const base = `/read/${encodeURIComponent(node.content_id || '')}`
  return node.source_type === 'article' ? base : `${base}?${node.source_type === 'note' ? 'note' : 'annotation'}=${encodeURIComponent(node.record_id)}`
}
