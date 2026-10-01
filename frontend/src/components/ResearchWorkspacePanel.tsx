import { useWikiLinks, wikiPlugin } from '../utils/wiki_markdown'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { api } from '../api'
import type { ResearchNote, ResearchProject } from '../types'
import { nodePath, type KnowledgeNode } from '../utils/knowledge_links'

function Markdown({ text }: { text: string }) {
  const links = useWikiLinks(text)
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, [wikiPlugin, { links }]]} rehypePlugins={[rehypeSanitize]}>{text}</ReactMarkdown></div>
}

export function ResearchHistory({ note, onRestore }: { note: ResearchNote; onRestore: (n: ResearchNote) => void }) {
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof api.researchVersions>>['items']>([])
  const [selected, setSelected] = useState('')
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof api.compareResearchVersion>> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; setComparison(null); setSelected(''); api.researchVersions(note.id).then((d) => { if (active) setVersions(d.items) }).catch((e) => { if (active) setError((e as Error).message) }); return () => { active = false } }, [note.id, note.revision])
  useEffect(() => { let active = true; setComparison(null); if (selected) api.compareResearchVersion(note.id, selected).then((d) => { if (active) setComparison(d) }).catch((e) => { if (active) setError((e as Error).message) }); return () => { active = false } }, [note.id, note.revision, selected])
  return <details className="panel"><summary>版本历史 · {versions.length} 个版本</summary><small>比较的是已保存正文。恢复会创建新版本；请先保存编辑器中的修改。</small><select aria-label="历史版本" value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">选择版本</option>{versions.map((v) => <option key={v.id} value={v.id}>{new Date(v.created_at).toLocaleString()} · {v.reason}</option>)}</select>
    {comparison && <><h4>与当前保存版本的差异</h4><pre className="version-diff">{comparison.diff || '正文没有差异'}</pre><details><summary>查看历史正文</summary><Markdown text={comparison.version.body_md} /></details><button className="button button-soft" disabled={busy} onClick={() => { if (!window.confirm('恢复此版本？编辑器中的未保存修改将被替换，当前已保存版本仍保留在历史中。')) return; setBusy(true); api.restoreResearchVersion(note.id, selected, comparison.current_revision).then(onRestore).catch((e) => setError((e as Error).message)).finally(() => setBusy(false)) }}>恢复为新版本</button></>}{error && <p role="alert">{error}</p>}
  </details>
}

export function ResearchWorkspacePanel() {
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.projects>>['items']>([])
  const [project, setProject] = useState<ResearchProject | null>(null)
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [followup, setFollowup] = useState('')
  const [query, setQuery] = useState('')
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [generatedNoteId, setGeneratedNoteId] = useState<string | null>(null)
  const projectId = params.get('project')
  const refresh = () => api.projects().then((d) => setItems(d.items))
  const accept = (p: ResearchProject) => { setProject(p); setChosen([...new Set(p.evidence.map((s) => s.source_id))]) }
  useEffect(() => { void refresh().catch((e) => setError((e as Error).message)) }, [])
  useEffect(() => { setGeneratedNoteId(null); let active = true; if (!projectId) { setProject(null); setChosen([]); return } api.project(projectId).then((p) => { if (active) { accept(p); setFollowup('') } }).catch((e) => { if (active) setError((e as Error).message) }); return () => { active = false } }, [projectId])
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { api.knowledgeNodes(query).then((d) => { if (active) setNodes(d.items.slice(0, 50)) }).catch(() => undefined) }, 300); return () => { active = false; window.clearTimeout(timer) } }, [query])
  const run = async (call: () => Promise<void>) => { setBusy(true); setError(''); try { await call(); await refresh() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return <><section className="panel knowledge-controls"><h2>持续研究工作区</h2><p>保存研究问题、证据快照和每次追问。原文更新不会悄悄改变当前证据集；需要时可主动刷新。</p><div className="knowledge-actions"><button className="button button-soft" disabled={busy} onClick={() => setParams({})}>新建研究</button>{items.map((p) => <button className="button button-soft" key={p.id} disabled={busy} onClick={() => setParams({ project: p.id })}>{p.title}</button>)}</div>
    {!project && <><label>项目名称<input value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>研究主问题<textarea value={question} onChange={(e) => setQuestion(e.target.value)} /></label></>}
    {project && <><h3>{project.title}</h3><p>{project.question}</p><small>证据集与对话版本：{project.revision}</small></>}
    <h3>选择证据资料（最多 16 份）</h3><input placeholder="搜索资料标题或 ID" value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} /><div className="knowledge-directory">{nodes.map((n) => <label key={n.source_id}><input type="checkbox" checked={chosen.includes(n.source_id)} disabled={busy || (chosen.length >= 16 && !chosen.includes(n.source_id))} onChange={() => setChosen(chosen.includes(n.source_id) ? chosen.filter((id) => id !== n.source_id) : [...chosen, n.source_id])} />{n.title} · {n.source_type}</label>)}</div><small>已选 {chosen.length} 份。未出现在搜索结果中的已选资料仍保留在下方证据集中。</small>
    <div className="knowledge-actions">{project ? <><button className="button button-primary" disabled={busy || !chosen.length} onClick={() => void run(async () => accept(await api.projectEvidence(project.id, project.revision, chosen)))}>保存证据集选择</button><button className="button button-soft" disabled={busy || !chosen.length} onClick={() => { if (window.confirm('从当前原文重新提取证据快照？历史回答的出处不会改变。')) void run(async () => accept(await api.projectEvidence(project.id, project.revision, chosen, true))) }}>刷新为当前原文</button></> : <button className="button button-primary" disabled={busy || !title.trim() || question.trim().length < 2 || !chosen.length} onClick={() => void run(async () => { const p = await api.createProject(title, question, chosen); accept(p); setParams({ project: p.id }) })}>创建并保存研究项目</button>}</div></section>
    {project && <><section className="panel knowledge-controls"><h3>当前证据快照</h3>{[...new Map(project.evidence.map((s) => [s.source_id, s])).values()].map((s) => <div key={s.source_id} className="knowledge-actions"><Link to={nodePath(s)}>{s.title}</Link><small>{s.source_type}</small><button disabled={busy} onClick={() => setChosen(chosen.filter((id) => id !== s.source_id))}>从选择中移除</button></div>)}<details><summary>展开证据片段</summary>{project.evidence.map((s) => <p key={s.chunk_id}>[{s.citation_id}] {s.title}：{s.text}</p>)}</details></section>
    <section className="panel knowledge-controls"><h3>继续研究</h3><textarea aria-label="研究追问" placeholder="追问、比较观点，或说明下一篇研究笔记的目标" value={followup} disabled={busy} onChange={(e) => setFollowup(e.target.value)} /><div className="knowledge-actions"><button className="button button-primary" disabled={busy || followup.trim().length < 2} onClick={() => void run(async () => { const d = await api.projectAsk(project.id, project.revision, followup); accept(d.project); setFollowup('') })}>基于证据集追问</button><button className="button button-soft" disabled={busy} onClick={() => void run(async () => { setGeneratedNoteId(null); const d = await api.projectAsk(project.id, project.revision, followup.trim() || project.question, true); accept(d.project); setGeneratedNoteId(d.note_id) })}>生成新的研究笔记</button></div><small>追问使用已保存的证据集，请先保存资料选择。</small></section>
    {generatedNoteId && <section className="panel knowledge-controls" role="status"><strong>研究笔记草稿已生成，已收录到「我的笔记」。</strong><p>核对内容与出处后，可保存为正式笔记。</p><div className="knowledge-actions"><Link className="button button-primary" to={`/ask?research=${encodeURIComponent(generatedNoteId)}`}>审阅生成的笔记</Link><Link className="button button-soft" to="/notes">查看我的笔记</Link></div></section>}
    {project.turns.map((t) => <section className="panel knowledge-result" key={t.id}><h3>{t.question}</h3><Markdown text={t.answer} /><details><summary>本轮出处快照 · {new Date(t.created_at).toLocaleString()}</summary>{t.sources.map((s) => <p key={s.chunk_id}>[{s.citation_id}] {s.title}：{s.text}</p>)}</details></section>)}<section className="panel knowledge-controls"><h3>研究成果</h3>{project.notes.map((n) => <p key={n.id}><Link to={'/ask?research=' + n.id}>{n.title}</Link> · {n.status === 'draft' ? '待审阅草稿' : '已保存'}</p>)}</section></>}
    {busy && <p role="status">正在处理，模型生成可能需要数分钟…</p>}{error && <p className="ask-error" role="alert">{error}</p>}
  </>
}
