import { ArrowRight, LoaderCircle, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import type { ReadingAIJob, ReadingAIResult, ReadingContext } from '../types'

export type ReadingAIAction = 'summary' | 'explain' | 'key_points'

type ReadingAIPanelProps = {
  context: ReadingContext
  actions: readonly (readonly [ReadingAIAction, string])[]
  action: ReadingAIAction | null
  job: ReadingAIJob | null
  results: ReadingAIResult[]
  currentResult: ReadingAIResult | null
  onStart: (action: ReadingAIAction) => void
  onCancel: () => void
  onRetry: () => void
  onDeleteResult: () => void
  onRegenerate: () => void
  onSaveAsNote: (result: ReadingAIResult) => void
  onSelectResult: (result: ReadingAIResult) => void
}

export function ReadingAIPanel({
  context, actions, action, job, results, currentResult, onStart, onCancel, onRetry,
  onDeleteResult, onRegenerate, onSaveAsNote, onSelectResult,
}: ReadingAIPanelProps) {
  let citations: Record<string, { text?: string }> = {}
  if (currentResult?.citations_json) {
    try { citations = JSON.parse(currentResult.citations_json) as Record<string, { text?: string }> }
    catch { citations = {} }
  }

  return <div className="reading-ai-panel">
    <div className="reading-panel-heading">
      <div><strong>只分析当前文章</strong><small>提交后按当前正文版本调用已配置的模型，并保存结果</small></div>
    </div>
    <div className="reading-ai-actions">
      {actions.map(([key, label]) => <button className="button button-soft" key={key} disabled={!context.revision_id || Boolean(job && ['queued', 'running'].includes(job.status))} onClick={() => onStart(key)}><Sparkles size={14} />{label}</button>)}
    </div>
    {job && <div className="reading-ai-progress">
      <LoaderCircle size={15} className={['queued','running'].includes(job.status) ? 'spin' : ''} />
      <span>{job.status === 'running' ? \`正在处理 \${job.completed_steps}/\${job.total_steps}\` : job.status === 'queued' ? '等待开始' : job.error_message || job.status}</span>
      {['queued','running'].includes(job.status) && <button onClick={onCancel}>取消</button>}
      {['failed','interrupted'].includes(job.status) && <button onClick={onRetry}>重试</button>}
    </div>}
    {currentResult && <div className="reading-ai-result">
      <div className="reading-result-actions">
        <strong>已保存的 AI 结果 {currentResult.revision_id !== context.revision_id && <small>基于旧正文版本</small>}</strong>
        <button className="button button-soft" onClick={() => onSaveAsNote(currentResult)}>保存为个人笔记</button>
        <button onClick={onDeleteResult} aria-label="删除结果"><Trash2 size={14} /></button>
        <button className="button button-soft" onClick={onRegenerate}><RefreshCw size={13} />重新生成</button>
      </div>
      <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{currentResult.rendered_md}</ReactMarkdown></div>
      <details className="reading-ai-citations">
        <summary>查看原文依据</summary>
        {Object.entries(citations).map(([id, citation]) => <p key={id}><b>[{id}]</b> {citation.text || ''}</p>)}
      </details>
    </div>}
    {results.length > 0 && <div className="reading-ai-history">
      <strong>历史结果</strong>
      {results.map((result) => <button key={result.id} onClick={() => onSelectResult(result)}>
        {result.action === 'summary' ? '全文总结' : result.action === 'explain' ? '段落解释' : '文章要点'} · {new Date(result.created_at).toLocaleString()}
        <ArrowRight size={13} />
      </button>)}
    </div>}
    {!context.revision_id && <p className="reading-empty">正文文件暂时不可用。已有笔记仍可查看。</p>}
  </div>
}
