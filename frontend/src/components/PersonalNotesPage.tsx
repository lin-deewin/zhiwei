import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import {
  BookOpen, Eye, FilePlus2, FileText, Grid2X2, History, Link2, List as ListIcon, LoaderCircle, Plus, RotateCcw, Save, Search, Trash2, X,
} from 'lucide-react'
import { api } from '../api'
import type { PersonalKnowledgeNote, PersonalKnowledgeNoteListItem, PersonalNoteSource, PersonalNoteVersion, PersonalNoteVersionSummary } from '../types'
import type { Notice } from '../types/ui'
import { useWikiLinks, wikiPlugin } from '../utils/wiki_markdown'
import { GraphPanel } from './KnowledgeGraphPanel'

type PersonalNotesPageProps = { onNotice: (notice: Notice) => void }

const sourceLabels: Record<string, string> = {
  article: '文章', note: '阅读笔记', annotation: '高亮批注',
  research: '研究成果', topic: '主题页', personal_note: '个人笔记',
}

export function PersonalNotesPage({ onNotice }: PersonalNotesPageProps) {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('note')
  const noteView = params.get('view') === 'cards' ? 'cards' : 'list'
  const setNoteView = (view: 'list' | 'cards') => {
    const next = new URLSearchParams(params)
    if (view === 'cards') next.set('view', 'cards')
    else next.delete('view')
    setParams(next, { replace: true })
  }
  const [items, setItems] = useState<PersonalKnowledgeNoteListItem[]>([])
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [note, setNote] = useState<PersonalKnowledgeNote | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sources, setSources] = useState<PersonalNoteSource[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceCandidates, setSourceCandidates] = useState<Awaited<ReturnType<typeof api.knowledgeNodes>>['items']>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [autoSavePaused, setAutoSavePaused] = useState(false)
  const [versions, setVersions] = useState<PersonalNoteVersionSummary[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyPreview, setHistoryPreview] = useState<PersonalNoteVersion | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const links = useWikiLinks(body)

  useEffect(() => {
    let active = true
    api.personalNotes(query).then((result) => { if (active) setItems(result.items) })
      .catch((error) => { if (active) onNotice({ message: (error as Error).message, error: true }) })
    return () => { active = false }
  }, [query, reloadKey, onNotice])

  useEffect(() => {
    if (!selectedId) {
      setNote(null); setTitle(''); setBody(''); setSources([]); setTags([]); setTagInput(''); setDirty(false)
      setVersions([]); setHistoryPreview(null); setHistoryOpen(false); setAutoSavePaused(false)
      return
    }
    let active = true
    setLoading(true)
    api.personalNote(selectedId).then((result) => {
      if (!active) return
      setNote(result); setTitle(result.title); setBody(result.body_md)
      setSources(result.sources); setTags(result.tags || []); setTagInput(''); setDirty(false); setAutoSavePaused(false)
      setHistoryPreview(null); setHistoryOpen(false)
    }).catch((error) => {
      if (active) {
        onNotice({ message: (error as Error).message, error: true })
        setParams({}, { replace: true })
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedId, reloadKey, onNotice, setParams])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    api.personalNoteVersions(selectedId).then((result) => { if (active) setVersions(result) })
      .catch((error) => { if (active) onNotice({ message: (error as Error).message, error: true }) })
    return () => { active = false }
  }, [selectedId, reloadKey, onNotice])

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
    if (busy) return
    if (dirty && !window.confirm('当前笔记有未保存的修改，确定放弃并切换吗？')) return
    setDirty(false)
    setHistoryPreview(null)
    const next = new URLSearchParams(params)
    next.set('note', id)
    setParams(next)
  }

  const createNote = async () => {
    if (busy || (dirty && !window.confirm('当前笔记有未保存的修改，确定放弃并新建吗？'))) return
    setDirty(false)
    setHistoryPreview(null)
    setBusy(true)
    try {
      const created = await api.createPersonalNote()
      setReloadKey((value) => value + 1)
      const next = new URLSearchParams(params)
      next.set('note', created.id)
      setParams(next)
      onNotice({ message: '已创建个人笔记' })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    } finally { setBusy(false) }
  }

  const saveNote = async () => {
    if (!note || busy) return
    setBusy(true)
    try {
      const updated = await api.savePersonalNote(note.id, title, body, note.revision, sources.map((source) => source.source_id), tags)
      setNote(updated); setTitle(updated.title); setBody(updated.body_md)
      setSources(updated.sources); setTags(updated.tags || []); setDirty(false); setAutoSavePaused(false)
      setReloadKey((value) => value + 1)
    } catch (error) {
      setAutoSavePaused(true)
      onNotice({ message: (error as Error).message, error: true })
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!note || !dirty || busy || autoSavePaused) return
    const timer = window.setTimeout(() => { void saveNote() }, 1200)
    return () => window.clearTimeout(timer)
  }, [note?.id, note?.revision, title, body, sources, tags, dirty, busy, autoSavePaused])

  const openVersion = async (revision: number) => {
    if (!note) return
    setHistoryLoading(true)
    try { setHistoryPreview(await api.personalNoteVersion(note.id, revision)) }
    catch (error) { onNotice({ message: (error as Error).message, error: true }) }
    finally { setHistoryLoading(false) }
  }

  const restoreVersion = () => {
    if (!historyPreview || !note || historyPreview.revision === note.revision) return
    if (!window.confirm('恢复这个版本的标题和正文？当前引用资料保持不变。')) return
    setTitle(historyPreview.title)
    setBody(historyPreview.body_md)
    setDirty(true)
    setAutoSavePaused(false)
    setPreview(false)
    setHistoryPreview(null)
    onNotice({ message: '历史内容已载入，稍后将自动保存为新版本' })
  }

  const deleteNote = async () => {
    if (!note || busy || !window.confirm('删除这条个人笔记？引用记录和知识链接也会一并删除。')) return
    setDirty(false)
    setHistoryPreview(null)
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
    if (busy) return
    const item = sourceCandidates.find((candidate) => candidate.source_id === sourceId)
    if (!item) return
    setSources((current) => current.some((source) => source.source_id === sourceId) ? current : [
      ...current,
      { source_id: item.source_id, source_type: item.source_type, title_snapshot: item.title, url_snapshot: null, created_at: new Date().toISOString() },
    ])
    setSourceQuery(''); setSourceCandidates([]); setDirty(true); setAutoSavePaused(false)
  }

  const addTag = () => {
    const tag = tagInput.trim()
    if (!tag) return
    if (tags.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      setTagInput('')
      return
    }
    if (tags.length >= 12) {
      onNotice({ message: '每条个人笔记最多添加 12 个标签', error: true })
      return
    }
    setTags((current) => [...current, tag])
    setTagInput('')
    setDirty(true)
    setAutoSavePaused(false)
  }

  const removeTag = (tag: string) => {
    if (busy) return
    setTags((current) => current.filter((value) => value !== tag))
    setDirty(true)
    setAutoSavePaused(false)
  }

  const toggleSelectedNote = (id: string, checked: boolean) => {
    setSelectedNoteIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const bulkDeleteNotes = async () => {
    if (busy) return
    const selected = items.filter((item) => selectedNoteIds.has(item.id))
    if (!selected.length || !window.confirm(`确定删除选中的 ${selected.length} 条个人笔记？其来源引用、版本历史和知识链接也会删除。`)) return
    setBusy(true)
    try {
      const result = await api.bulkDeletePersonalNotes(selected.map(({ id, revision }) => ({ id, revision })))
      if (selectedId && selectedNoteIds.has(selectedId)) {
        setDirty(false)
        setParams({}, { replace: true })
      }
      setSelectedNoteIds(new Set())
      setReloadKey((value) => value + 1)
      onNotice({ message: `已删除 ${result.deleted} 条个人笔记` })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    } finally { setBusy(false) }
  }

  const removeSource = (sourceId: string) => {
    if (busy) return
    setSources((current) => current.filter((source) => source.source_id !== sourceId))
    setDirty(true); setAutoSavePaused(false)
  }

  return <section className="personal-notes-page">
    <aside className="personal-notes-index panel">
      <div className="personal-notes-index-head">
        <div><span className="eyebrow">YOUR KNOWLEDGE</span><h1>个人笔记</h1></div>
        <div className="personal-notes-index-tools">
          <div className="personal-note-view-toggle" role="group" aria-label="笔记显示方式">
            <button type="button" aria-label="列表视图" aria-pressed={noteView === 'list'} className={noteView === 'list' ? 'selected' : ''} onClick={() => setNoteView('list')}><ListIcon size={15} /></button>
            <button type="button" aria-label="卡片视图" aria-pressed={noteView === 'cards'} className={noteView === 'cards' ? 'selected' : ''} onClick={() => setNoteView('cards')}><Grid2X2 size={15} /></button>
          </div>
          <button className="button button-primary button-icon" onClick={() => void createNote()} disabled={busy} aria-label="新建个人笔记" title="新建个人笔记"><FilePlus2 size={17} /></button>
        </div>
      </div>
      <label className="personal-notes-search"><Search size={16} /><input aria-label="搜索个人笔记" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedNoteIds(new Set()) }} placeholder="搜索个人笔记…" /></label>
      {selectedNoteIds.size > 0 && <div className="personal-note-bulk-bar">
        <span>{selectedNoteIds.size} / 50 条已选</span>
        <button className="button button-danger-quiet" disabled={busy} onClick={() => void bulkDeleteNotes()}><Trash2 size={13} />批量删除</button>
        <button className="button button-soft" disabled={busy} onClick={() => setSelectedNoteIds(new Set())}>取消选择</button>
      </div>}
      <div className={'personal-notes-items' + (noteView === 'cards' ? ' is-cards' : '')}>
        {items.map((item) => <div key={item.id} className="personal-note-list-row">
          <input type="checkbox" aria-label={`选择 ${item.title || '未命名笔记'}`} checked={selectedNoteIds.has(item.id)} disabled={busy || (!selectedNoteIds.has(item.id) && selectedNoteIds.size >= 50)} onChange={(event) => toggleSelectedNote(item.id, event.target.checked)} />
          <button className={'personal-note-list-item' + (selectedId === item.id ? ' active' : '') + (noteView === 'cards' ? ' as-card' : '')} disabled={busy} onClick={() => chooseNote(item.id)}>
            <strong>{item.title || '未命名笔记'}</strong>
            <span>{item.excerpt || '尚未添加正文'}</span>
            {!!item.tags?.length && <div className="personal-note-list-tags">{item.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}
            <small>{item.source_count} 个引用 · {new Date(item.updated_at).toLocaleDateString('zh-CN')}</small>
          </button>
        </div>)}
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
      {selectedId && <div className="personal-note-document panel">
        {loading && <div className="personal-note-loading"><LoaderCircle size={18} /> 正在读取笔记…</div>}
        {note && <>
          <div className="personal-note-editor-head">
            <div><span className="eyebrow">PERSONAL KNOWLEDGE</span><span className="personal-note-revision">版本 {note.revision}</span></div>
            <div className="personal-note-actions">
              <span className="personal-note-save-state" aria-live="polite">{busy ? '保存中…' : dirty ? autoSavePaused ? '自动保存已暂停' : '修改将自动保存' : '已保存'}</span>
              <button className="button button-soft" onClick={() => setHistoryOpen((value) => !value)}><History size={15} />版本历史</button>
              <button className="button button-soft" onClick={() => setPreview((value) => !value)}><Eye size={15} />{preview ? '继续编辑' : '预览'}</button>
              <button className="button button-primary" onClick={() => void saveNote()} disabled={!dirty || busy}><Save size={15} />{busy ? '保存中…' : '立即保存'}</button>
              <button className="button button-danger-quiet" onClick={() => void deleteNote()} disabled={busy} aria-label="删除笔记"><Trash2 size={15} /></button>
            </div>
          </div>
          {historyOpen && <section className="personal-note-history">
            <div className="personal-note-history-heading"><div><strong>版本历史</strong><small>每次保存都会保留一个可恢复版本</small></div><button aria-label="关闭版本历史" onClick={() => { setHistoryOpen(false); setHistoryPreview(null) }}><X size={14} /></button></div>
            <div className="personal-note-history-list">
              {versions.map((version) => <button key={version.revision} className={historyPreview?.revision === version.revision ? 'active' : ''} onClick={() => void openVersion(version.revision)}>
                <span>v{version.revision}</span><strong>{version.title || '未命名笔记'}</strong><small>{new Date(version.created_at).toLocaleString('zh-CN')} · {version.body_length} 字 · {version.source_count} 个引用</small>
              </button>)}
              {!versions.length && !historyLoading && <small>还没有历史版本。</small>}
            </div>
            {historyLoading && <div className="personal-note-loading"><LoaderCircle size={15} />正在读取版本…</div>}
            {historyPreview && <div className="personal-note-history-preview">
              <div><strong>v{historyPreview.revision} · {historyPreview.title || '未命名笔记'}</strong><small>{new Date(historyPreview.created_at).toLocaleString('zh-CN')} · {historyPreview.sources.length} 个引用</small></div>
              <article><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{historyPreview.body_md || '（空白正文）'}</ReactMarkdown></article>
              <div><button className="button button-soft" onClick={() => setHistoryPreview(null)}>关闭预览</button><button className="button button-primary" disabled={historyPreview.revision === note.revision} onClick={restoreVersion}><RotateCcw size={14} />恢复标题和正文</button></div>
            </div>}
          </section>}
          <div className="personal-note-tags">
            <div className="personal-note-tag-list">
              {tags.map((tag) => <button key={tag} type="button" disabled={busy} onClick={() => removeTag(tag)} title="移除标签"><span>{tag}</span><X size={11} /></button>)}
              {!tags.length && <small>添加标签，方便整理和检索</small>}
            </div>
            <form onSubmit={(event) => { event.preventDefault(); addTag() }}>
              <input aria-label="新标签" value={tagInput} maxLength={24} disabled={busy} placeholder="输入标签，按回车添加" onChange={(event) => setTagInput(event.target.value)} />
              <button type="submit" disabled={busy || !tagInput.trim() || tags.length >= 12} aria-label="添加标签"><Plus size={14} /></button>
            </form>
          </div>
          <input className="personal-note-title" disabled={busy} value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); setAutoSavePaused(false) }} placeholder="给这条笔记起个标题…" />
          {preview
            ? <article className="personal-note-preview"><ReactMarkdown remarkPlugins={[remarkGfm, [wikiPlugin, { links }]]} rehypePlugins={[rehypeSanitize]}>{body || '（暂无正文）'}</ReactMarkdown></article>
            : <textarea className="personal-note-body" disabled={busy} value={body} onChange={(event) => { setBody(event.target.value); setDirty(true); setAutoSavePaused(false) }} placeholder="写下自己的理解、推理、疑问和结论。支持 Markdown 与 [[双向链接]]。" spellCheck />}
          <section className="personal-note-sources">
            <div className="personal-note-section-title"><div><Link2 size={16} /><strong>引用资料</strong><small>{sources.length} 份</small></div></div>
            <label className="personal-note-source-search"><Search size={15} /><input value={sourceQuery} disabled={busy} onChange={(event) => setSourceQuery(event.target.value)} placeholder="搜索文章、阅读笔记、研究成果或其他个人笔记…" /></label>
            {!!sourceCandidates.length && <div className="personal-note-source-candidates">
              {sourceCandidates.slice(0, 8).map((candidate) => <button key={candidate.source_id} onClick={() => addSource(candidate.source_id)}>
                <span>{sourceLabels[candidate.source_type] || candidate.source_type}</span><strong>{candidate.title}</strong><Plus size={14} />
              </button>)}
            </div>}
            <div className="personal-note-source-list">
              {sources.map((source) => <div key={source.source_id} className="personal-note-source">
                <span>{sourceLabels[source.source_type] || source.source_type}</span><strong>{source.title_snapshot}</strong>
                {source.available === false && <small className="personal-note-source-missing">来源已删除</small>}
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
