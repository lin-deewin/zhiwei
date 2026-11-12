import { useWorkspaceActive } from './WorkspaceTabs'
import { useWikiLinks, wikiPlugin } from '../utils/wiki_markdown'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { ArrowRight, LoaderCircle, Save, Search, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../api'
import { SemanticPanel } from './SemanticPanel'
import { ResearchHistory } from './ResearchWorkspacePanel'
import { GraphPanel } from './KnowledgeHub'
import { nodePath } from '../utils/knowledge_links'
import type { AskResult, Category, EvidenceKind, EvidenceSource, ResearchNote } from '../types'

const labels: Record<EvidenceKind, string> = { article: '文章原文', note: '个人笔记', annotation: '高亮批注', research: 'AI 研究笔记', topic: '主题知识页', personal_note: '个人笔记' }
function sourcePath(source: EvidenceSource) {
  return nodePath(source)
}

function EvidenceList({ sources, prefix }: { sources: EvidenceSource[]; prefix: string }) {
  return <div className="knowledge-evidence"><h3>出处与生成时的证据快照</h3>{sources.map((source) => <details key={source.chunk_id} id={`${prefix}-${source.citation_id}`}>
    <summary><b>[{source.citation_id}]</b> {labels[source.source_type]} · {source.title}</summary>
    <p>{source.text}</p>{source.excerpted && <small>已按研究问题节选；这是模型实际使用的片段。</small>}<small>{source.article_title || source.title} · {source.heading} · 内容指纹 {source.content_hash.slice(0, 12)}</small>
    <Link className="answer-source" to={sourcePath(source)}>查看当前资料 <ArrowRight size={14} /></Link>
  </details>)}</div>
}

function CitedMarkdown({ text, prefix }: { text: string; prefix: string }) {
  const links = useWikiLinks(text)
  const linked = text.replace(/\[(S\d+)\]/g, '[[$1]](#' + prefix + '-$1)')
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, [wikiPlugin, { links }]]} rehypePlugins={[rehypeSanitize]}>{linked}</ReactMarkdown></div>
}

export function ResearchNotesList({ query = '', version = 0 }: { query?: string; version?: number }) {
  const workspaceActive = useWorkspaceActive()
  const [items, setItems] = useState<Pick<ResearchNote, 'id' | 'title' | 'question' | 'status' | 'updated_at'>[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!workspaceActive) return
    let active = true
    const timer = window.setTimeout(() => {
      api.researchNotes(query, true).then((data) => { if (active) { setItems(data.items); setError('') } })
        .catch((e) => { if (active) setError((e as Error).message) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query, version, workspaceActive])
  return <section className="research-library"><h2>研究笔记</h2>{error && <p role="alert">{error}</p>}
    {items.length ? <div className="notes-search-results">{items.map((item) => <Link className="panel notes-result" key={item.id} to={`/ask?research=${encodeURIComponent(item.id)}`}><small>{item.status === 'draft' ? '待审阅草稿' : '已保存'} · {new Date(item.updated_at).toLocaleDateString()}</small><h3>{item.title}</h3><p>{item.question}</p><span>查看笔记和出处 <ArrowRight size={14} /></span></Link>)}</div> : !error && <p className="muted-text">暂无匹配的研究笔记。可在知识空间或知识问答中生成；草稿也会显示在这里。</p>}
  </section>
}

export function KnowledgePage({ categories }: { categories: Category[] }) {
  const [params, setParams] = useSearchParams()
  const [question, setQuestion] = useState('')
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [kinds, setKinds] = useState<EvidenceKind[]>(['article', 'note', 'annotation', 'research', 'topic'])
  const [sources, setSources] = useState<EvidenceSource[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [answer, setAnswer] = useState<AskResult | null>(null)
  const [draft, setDraft] = useState<ResearchNote | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [version, setVersion] = useState(0)
  const dirty = Boolean(draft && (title !== draft.title || body !== draft.body_md))
  const researchId = params.get('research')
  const acceptNote = (note: ResearchNote) => { setDraft(note); setTitle(note.title); setBody(note.body_md) }
  useEffect(() => {
    if (!researchId) return
    let active = true
    api.researchNote(researchId).then((note) => { if (active) acceptNote(note) })
      .catch((e) => { if (active) setError((e as Error).message) })
    return () => { active = false }
  }, [researchId])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const guard = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null
      if (!link || link.target === '_blank' || link.origin !== window.location.origin) return
      if (link.pathname === window.location.pathname && link.search === window.location.search) return
      if (!window.confirm('正文有未保存的修改，离开后这些修改将丢失。继续离开？')) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', guard, true)
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guard, true) }
  }, [dirty])
  const clearSearch = () => { setSources([]); setSelected([]); setAnswer(null); setSearched(false); setError('') }
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return
    setBusy(label); setError('')
    try { await action() } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  const search = () => run('检索资料', async () => {
    const result = await api.searchKnowledge(question.trim(), categoryId, kinds)
    setSources(result.sources); setSelected(result.sources.slice(0, 8).map((s) => s.chunk_id)); setSearched(true)
  })
  const uniqueSelected = new Set(sources.filter((s) => selected.includes(s.chunk_id)).map((s) => s.source_id)).size
  const download = () => {
    if (!draft) return
    const provenance = draft.sources.map((s) => `### [${s.citation_id}] ${labels[s.source_type]}：${s.title}\n\n来源记录：${s.source_id}\n\n来源链接：${s.url || sourcePath(s)}\n\n${s.markdown_path ? `原文文件：${s.markdown_path}\n\n` : ''}内容指纹：${s.content_hash}\n\n${s.text}`).join('\n\n')
    const blob = new Blob([`# ${title}\n\n${body}\n\n## 证据快照\n\n${provenance}`], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '研究笔记'}.md`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="subpage knowledge-page">
    <div className="page-title-row"><div><div className="eyebrow">ASK YOUR LIBRARY</div><h1>让资料，开始回答。</h1><p>文章、笔记与批注一起检索；用多份证据形成可追溯的研究笔记。</p></div></div>
    <SemanticPanel question={question} expected={[...new Set(sources.filter((s) => selected.includes(s.chunk_id)).map((s) => s.source_id))]} />
    <section className="panel knowledge-controls">
      <label>检索范围<select disabled={Boolean(busy)} value={categoryId ?? ''} onChange={(e) => { clearSearch(); setCategoryId(e.target.value ? Number(e.target.value) : undefined) }}><option value="">全部资料</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '　↳ ' : ''}{c.name}</option>)}</select></label>
      <fieldset disabled={Boolean(busy)}><legend>资料类型</legend>{(Object.keys(labels) as EvidenceKind[]).map((kind) => <label key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={() => { clearSearch(); setKinds(kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]) }} />{labels[kind]}</label>)}</fieldset>
      <label className="knowledge-question">问题或研究主题<textarea disabled={Boolean(busy)} value={question} maxLength={2000} onChange={(e) => { setQuestion(e.target.value); clearSearch() }} placeholder="例如：结合收藏文章和我的笔记，比较提升专注力的方法与局限。" /></label>
      <div className="knowledge-actions"><button className="button button-soft" disabled={Boolean(busy) || question.trim().length < 2 || !kinds.length} onClick={() => void search()}><Search size={16} />查找资料</button><button className="button button-primary" disabled={Boolean(busy) || question.trim().length < 2 || !kinds.length} onClick={() => void run('生成回答', async () => { setAnswer(await api.ask(question.trim(), categoryId, kinds)) })}><Sparkles size={16} />根据资料回答</button></div>
      <small>检索在本地执行。生成回答或研究笔记时，候选片段会发送给已配置的模型。按分类筛选时，仅包含该分类下的文章及其笔记、批注。</small>
    </section>
    {busy && <p role="status"><LoaderCircle className="spin" size={16} /> 正在{busy}…</p>}{error && <div className="ask-error" role="alert">{error}</div>}
    {answer && <section className="panel knowledge-result"><h2>知识库回答</h2><CitedMarkdown text={answer.answer} prefix="answer-evidence" /><small>{answer.retrieval.includes('model-rerank') ? '已使用模型重排证据' : answer.retrieval.includes('semantic') ? '关键词与语义融合检索' : '基于统一关键词检索'}</small><EvidenceList sources={answer.sources} prefix="answer-evidence" /></section>}
    {searched && <section className="panel knowledge-results"><div className="panel-title"><h2>选择研究资料</h2><span>已选 {selected.length} 个片段 · {uniqueSelected} 份资料</span></div>
      {sources.length ? sources.map((source) => <div className="knowledge-source" key={source.chunk_id}><input aria-label={`选择${labels[source.source_type]}：${source.title}，${source.heading}`} type="checkbox" disabled={Boolean(busy) || (!selected.includes(source.chunk_id) && selected.length >= 16)} checked={selected.includes(source.chunk_id)} onChange={() => setSelected(selected.includes(source.chunk_id) ? selected.filter((id) => id !== source.chunk_id) : [...selected, source.chunk_id])} /><div><strong>{labels[source.source_type]} · {source.title}</strong><small>{source.match_methods?.includes('semantic') ? '语义匹配' : '关键词匹配'}</small><p>{source.text.slice(0, 180)}{source.text.length > 180 ? '…' : ''}</p>{source.text.length > 180 && <details><summary>展开完整片段</summary><p>{source.text}</p></details>}<Link to={sourcePath(source)}>查看资料</Link></div></div>) : <p>未找到相关资料。请调整关键词或范围。</p>}
      <button className="button button-primary" disabled={Boolean(busy) || uniqueSelected < 2} onClick={() => { if (!dirty || window.confirm('生成新研究笔记将替换当前编辑内容，继续？')) void run('生成研究笔记', async () => { const note = await api.generateResearch(question.trim(), selected, categoryId, kinds); acceptNote(note); setParams({ research: note.id }); setVersion((v) => v + 1) }) }}><Sparkles size={16} />生成带出处的研究笔记</button><small>至少两份不同资料，最多 16 个片段。生成后可核对、编辑并保存。</small>
    </section>}
    {draft && <section className="panel research-editor"><div className="panel-title"><h2>{draft.status === 'saved' ? '研究笔记' : '研究笔记草稿'}</h2><span>研究问题：{draft.question}</span></div>
      <label>标题<input disabled={Boolean(busy)} value={title} maxLength={1000} onChange={(e) => setTitle(e.target.value)} /></label><label>正文（Markdown）<textarea disabled={Boolean(busy)} value={body} maxLength={100000} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="knowledge-actions"><button className="button button-primary" disabled={Boolean(busy) || !title.trim() || !body.trim()} onClick={() => void run('保存研究笔记', async () => { acceptNote(await api.saveResearch(draft.id, title, body, draft.revision)); setVersion((v) => v + 1) })}><Save size={16} />{draft.status === 'saved' ? '保存修改' : '保存到我的笔记'}</button><button className="button button-soft" onClick={download}>导出 Markdown</button><button className="button button-soft" disabled={Boolean(busy)} onClick={() => { if (window.confirm('删除这篇研究笔记？')) void run('删除笔记', async () => { await api.deleteResearch(draft.id); setDraft(null); setParams({}); setVersion((v) => v + 1) }) }}><Trash2 size={16} />删除</button></div>
      {draft.status === 'saved' && <GraphPanel sourceId={'research:' + draft.id} version={version} />}<ResearchHistory note={draft} onRestore={(note) => { acceptNote(note); setVersion((v) => v + 1) }} /><CitedMarkdown text={body} prefix="research-evidence" /><EvidenceList sources={draft.sources} prefix="research-evidence" /><small>出处快照保留生成时的片段；当前原文可能已修改。引用编号有效不代表模型结论一定正确，请核对。</small>
    </section>}
    <ResearchNotesList version={version} />
  </div>
}
