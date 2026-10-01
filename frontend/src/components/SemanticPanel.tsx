import { useEffect, useState } from 'react'
import { api } from '../api'

export function SemanticPanel({ question, expected }: { question: string; expected: string[] }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.semanticStatus>> | null>(null)
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.evaluateRetrieval>> | null>(null)
  const [cases, setCases] = useState<Awaited<ReturnType<typeof api.retrievalCases>>['items']>([])
  const [extraIds, setExtraIds] = useState('')
  const expectedIds = [...new Set([...expected, ...extraIds.split(/[\s,，]+/).filter(Boolean)])]
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = async () => { setStatus(await api.semanticStatus()); setCases((await api.retrievalCases()).items) }
  useEffect(() => {
    let active = true
    const update = () => { api.semanticStatus().then((s) => { if (active) setStatus(s) }).catch((e) => { if (active) setError((e as Error).message) }) }
    update(); api.retrievalCases().then((c) => { if (active) setCases(c.items) }).catch(() => undefined)
    const timer = window.setInterval(update, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); await refresh() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const running = ['queued', 'running'].includes(status?.job?.status || '')
  return <details className="panel knowledge-controls"><summary>语义检索与效果验证 · 已索引 {status?.indexed_chunks ?? 0} 个片段</summary>
    <p>本地中文向量模型与关键词共同检索。首次建立索引需要下载模型；之后计算留在本机。已有索引每两分钟检查新增与修改。</p>
    <div className="knowledge-actions"><button className="button button-soft" disabled={busy || running} onClick={() => void run(async () => { setStatus(await api.startSemanticIndex()) })}>{status?.indexed_chunks ? '更新语义索引' : '建立语义索引'}</button>{running && <button className="button button-soft" onClick={() => void run(async () => { setStatus(await api.cancelSemanticIndex()) })}>取消索引</button>}</div>
    {status?.job && <p>{({ queued: '等待中', running: '索引中', completed: '已完成', cancelled: '已取消', interrupted: '已中断', failed: '失败' } as Record<string, string>)[status.job.status] || status.job.status} · {status.job.processed}/{status.job.total} · {status.job.model}{status.job.error && <span role="alert"> · {status.job.error}</span>}</p>}
    <h3>检索评测</h3><p>在资料列表勾选你认为应命中的正确资料，再记录测试问题。对比前 5 个片段的 Recall@5 与 MRR，数值越高越好。</p>
    <label>补充正确资料 ID（包括未检索出的资料）<input placeholder="article:ID 或 note:ID，多个用空格分隔" value={extraIds} onChange={(e) => setExtraIds(e.target.value)} /></label><div className="knowledge-actions"><button className="button button-soft" disabled={busy || question.trim().length < 2 || !expectedIds.length} onClick={() => void run(async () => { await api.addRetrievalCase(question, expectedIds); setReport(null) })}>将当前问题与所选资料加入评测</button><button className="button button-soft" disabled={busy || !cases.length} onClick={() => void run(async () => { setReport(await api.evaluateRetrieval()) })}>运行对比评测</button></div>
    {cases.map((c) => <div className="knowledge-actions" key={c.id}><span>{c.question} · {c.expected_sources.length} 份正确资料</span><button disabled={busy} onClick={() => void run(async () => { await api.deleteRetrievalCase(c.id); setReport(null) })}>移除测试问题</button></div>)}
    {report && <div><table><thead><tr><th>检索方式</th><th>Recall@5</th><th>MRR</th></tr></thead><tbody>{Object.entries(report.summary).map(([method, score]) => <tr key={method}><td>{method === 'keyword' ? '关键词' : '关键词＋语义'}</td><td>{score.recall_at_k.toFixed(3)}</td><td>{score.mrr.toFixed(3)}</td></tr>)}</tbody></table><small>评测结果只代表这些测试问题，不等于全部问答的准确率。</small></div>}
    {error && <p role="alert">{error}</p>}
  </details>
}
