import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import {
  BookOpen, Eye, FilePlus2, FileText, Link2, LoaderCircle, Plus, Save, Search, Trash2, X,
} from 'lucide-react'
import { api } from '../api'
import type { PersonalKnowledgeNote, PersonalKnowledgeNoteListItem, PersonalNoteSource } from '../types'
import type { Notice } from '../types/ui'
import { useWikiLinks, wikiPlugin } from '../utils/wiki_markdown'
import { GraphPanel } from './KnowledgeHub'

type PersonalNotesPageProps = { onNotice: (notice: Notice) => void }

const sourceLabels: Record<string, string> = {
  article: '文章', note: '阅读笔记', annotation: '高亮批注',
  research: '研究成果', topic: '主题页', personal_note: '个人笔记',
}

export function PersonalNotesPage({ onNotice }: PersonalNotesPageProps) {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('note')
  const [items, setItems] = useState<PersonalKnowledgeNoteListItem[]>([])
  const [query, setQuery] = useState('')
  const [note, setNote] = useState<PersonalKnowledgeNote | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sources, setSources] = useState<PersonalNoteSource[]>([])
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceCandidates, setSourceCandidates] = useState<Awaited<ReturnType<typeof api.knowledgeNodes>>['items']>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const links = useWikiLinks(body)

  useEffect(() => {
    let active = true
    api.personalNotes(query).then((result) => { if (active) setItems(result.items) })
      .catch((error) => { if (active) onNotice({ message: (error as Error).message, error: true }) })
    return () => { active = false }
  }, [query, reloadKey, onNotice])

  useEffect(() => {
    if (!selectedId) {
      setNote(null); setTitle(''); setBody(''); setSources([]); setDirty(false)
      return
    }
    let active = true
    setLoading(true)
    api.personalNote(selectedId).then((result) => {
      if (!active) return
      setNote(result); setTitle(result.title); setBody(result.body_md)
      setSources(result.sources); setDirty(false)
    }).catch((error) => {
      if (active) {
        onNotice({ message: (error as Error).message, error: true })
        setParams({}, { replace: true })
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedId, reloadKey, onNotice, setParams])

  useEffect(() => {
    if (!sourceQuery.trim()) { setSourceCandidates([]); return }
    let active = true
    const timer = window.setTimeout(() => {
      api.knowledgeNodes(sourceQuery).then((result) => {
        if (!active) return
        const selected = new Set(sources.map((source) => source.source_id))
        const ownId = 'personal_note:' + (note?.id || '')
        setSourceCandidates(result.items.filter((item) => item.source_id !== ownId && !selected.has(item.source_id)))
      }).catch(() => { if (active) setSourceCandidates([]) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [sourceQuery, note?.id, sources])

  const chooseNote = (id: string) => {
    if (dirty && !window.confirm('当前笔记有未保存的修改，确定放弃并切换吗？')) return
    setParams({ note: id })
  }

  const createNote = async () => {
    if (dirty && !window.confirm('当前笔记有未保存的修改，确定放弃并新建吗？')) return
    setBusy(true)
    try {
      const created = await api.createPersonalNote()
      setReloadKey((value) => value + 1)
      setParams({ note: created.id })
      onNotice({ message: '已创建个人笔记' })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    } finally { setBusy(false) }
  }

  const saveNote = async () => {
    if (!note || busy) return
    setBusy(true)
    try {
      const updated = await api.savePersonalNote(note.id, title, body, note.revision, sources.map((source) => source.source_id))
      setNote(updated); setTitle(updated.title); setBody(updated.body_md)
      setSources(updated.sources); setDirty(false)
      setReloadKey((value) => value + 1)
      onNotice({ message: '个人笔记已保存' })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    } finally { setBusy(false) }
  }

  const deleteNote = async () => {
    if (!note || busy || !window.confirm('删除这条个人笔记？引用记录和知识链接也会一并删除。')) return
    setBusy(true)
    try {
      await api.deletePersonalNote(note.id, note.revision)
      setParams({}, { replace: true }); setReloadKey((value) => value + 1)
      onNotice({ message: '个人笔记已删除' })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    } finally { setBusy(false) }
  }

  const addSource = (sourceId: string) => {
    const item = sourceCandidates.find((candidate) => candidate.source_id === sourceId)
    if (!item) return
    setSources((current) => current.some((source) => source.source_id === sourceId) ? current : [
      ...current,
      { source_id: item.source_id, source_type: item.source_type, title_snapshot: item.title, url_snapshot: null, created_at: new Date().toISOString() },
    ])
    setSourceQuery(''); setSourceCandidates([]); setDirty(true)
  }

  const removeSource = (sourceId: string) => {
    setSources((current) => current.filter((source) => source.source_id !== sourceId))
    setDirty(true)
  }

  return <section className="personal-notes-page">
    <aside className="personal-notes-index panel">
      <div className="personal-notes-index-head">
        <div><span className="eyebrow">YOUR KNOWLEDGE</span><h1>个人笔记</h1></div>
        <button className="button button-primary button-icon" onClick={() => void createNote()} disabled={busy} aria-label="新建个人笔记" title="新建个人笔记"><FilePlus2 size={17} /></button>
      </div>
      <label className="personal-notes-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索个人笔记…" /></label>
      <div className="personal-notes-items">
        {items.map((item) => <button key={item.id} className={'personal-note-list-item' + (selectedId === item.id ? ' active' : '')} onClick={() => chooseNote(item.id)}>
          <strong>{item.title || '未命名笔记'}</strong>
          <span>{item.excerpt || '尚未添加正文'}</span>
          <small>{item.source_count} 个引用 · {new Date(item.updated_at).toLocaleDateString('zh-CN')}</small>
        </button>)}
        {!items.length && <div className="personal-notes-empty"><FileText size={20} /><span>{query ? '没有找到匹配的笔记' : '还没有个人笔记'}</span><small>把阅读中的想法、判断和总结写在这里</small></div>}
      </div>
    </aside>

    <main className="personal-note-workspace">
      {!selectedId && <div className="personal-note-welcome panel">
        <div className="personal-note-welcome-icon"><BookOpen size={24} /></div>
        <h2>把读到的内容，变成自己的知识</h2>
        <p>个人笔记独立于外部文章，可以引用多份资料，也可以与其他个人笔记建立明确的双向链接。</p>
        <button className="button button-primary" onClick={() => void createNote()} disabled={busy}><Plus size={16} /> 新建个人笔记</button>
      </div>}
      {selectedId && <div className="personal-note-editor panel">
        {loading && <div className="personal-note-loading"><LoaderCircle size={18} /> 正在读取笔记…</div>}
        {note && <>
          <div className="personal-note-editor-head">
            <div><span className="eyebrow">PERSONAL KNOWLEDGE</span><span className="personal-note-revision">版本 {note.revision}</span></div>
            <div className="personal-note-actions">
              <button className="button button-soft" onClick={() => setPreview((value) => !value)}><Eye size={15} />{preview ? '继续编辑' : '预览'}</button>
              <button className="button button-primary" onClick={() => void saveNote()} disabled={!dirty || busy}><Save size={15} />{busy ? '保存中…' : '保存'}</button>
              <button className="button button-danger-quiet" onClick={() => void deleteNote()} disabled={busy} aria-label="删除笔记"><Trash2 size={15} /></button>
            </div>
          </div>
          <input className="personal-note-title" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true) }} placeholder="给这条笔记起个标题…" />
          {preview
            ? <article className="personal-note-preview"><ReactMarkdown remarkPlugins={[remarkGfm, [wikiPlugin, { links }]]} rehypePlugins={[rehypeSanitize]}>{body || '（暂无正文）'}</ReactMarkdown></article>
            : <textarea className="personal-note-body" value={body} onChange={(event) => { setBody(event.target.value); setDirty(true) }} placeholder="写下自己的理解、推理、疑问和结论。支持 Markdown 与 [[双向链接]]。" spellCheck />}
          <section className="personal-note-sources">
            <div className="personal-note-section-title"><div><Link2 size={16} /><strong>引用资料</strong><small>{sources.length} 份</small></div></div>
            <label className="personal-note-source-search"><Search size={15} /><input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="搜索文章、阅读笔记、研究成果或其他个人笔记…" /></label>
            {!!sourceCandidates.length && <div className="personal-note-source-candidates">
              {sourceCandidates.slice(0, 8).map((candidate) => <button key={candidate.source_id} onClick={() => addSource(candidate.source_id)}>
                <span>{sourceLabels[candidate.source_type] || candidate.source_type}</span><strong>{candidate.title}</strong><Plus size={14} />
              </button>)}
            </div>}
            <div className="personal-note-source-list">
              {sources.map((source) => <div key={source.source_id} className="personal-note-source">
                <span>{sourceLabels[source.source_type] || source.source_type}</span><strong>{source.title_snapshot}</strong>
                <button aria-label="移除引用" onClick={() => removeSource(source.source_id)}><X size={14} /></button>
              </div>)}
              {!sources.length && <small>引用是资料出处，不会自动把外部文章变成双向链接。</small>}
            </div>
          </section>
          <GraphPanel sourceId={'personal_note:' + note.id} version={note.revision} />
        </>}
      </div>}
    </main>
  </section>
}
