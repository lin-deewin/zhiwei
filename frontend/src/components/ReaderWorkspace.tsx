import { WikiMarkdown } from './WikiMarkdown'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, Highlighter, LoaderCircle, Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { api } from '../api'
import { newRequestKey } from '../utils/request_key'
import type { Annotation, PersonalNote, ReadingAIJob, ReadingAIResult, ReadingContext, TextAnchor } from '../types'

function codePointOffset(node: Node, offset: number): number {
  const root = node.parentElement?.closest<HTMLElement>('[data-reading-block-id]')
  if (!root) return 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let result = 0
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text
    if (textNode === node) return result + Array.from(textNode.data.slice(0, offset)).length
    result += Array.from(textNode.data).length
  }
  return result
}

export function anchorFromSelection(context: ReadingContext): TextAnchor | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const startElement = range.startContainer.parentElement?.closest<HTMLElement>('[data-reading-block-id]')
  const endElement = range.endContainer.parentElement?.closest<HTMLElement>('[data-reading-block-id]')
  if (!startElement || startElement !== endElement || !context.revision_id) return null
  const blockId = startElement.dataset.readingBlockId
  const block = context.blocks.find((item) => item.id === blockId)
  if (!block?.markable) return null
  const start = codePointOffset(range.startContainer, range.startOffset)
  const end = codePointOffset(range.endContainer, range.endOffset)
  const chars = Array.from(block.text)
  if (end <= start || end > chars.length) return null
  const exact = chars.slice(start, end).join('')
  if (exact !== range.toString()) return null
  return {
    revision_id: context.revision_id,
    normalization_version: context.normalization_version,
    block_id: block.id,
    start,
    end,
    exact,
    prefix: chars.slice(Math.max(0, start - 32), start).join(''),
    suffix: chars.slice(end, end + 32).join(''),
    block_hash: block.text_hash,
    heading_path: block.heading_path,
  }
}

function rangeForAnchor(anchor: TextAnchor): Range | null {
  const root = document.querySelector<HTMLElement>(`[data-reading-block-id="${CSS.escape(anchor.block_id)}"]`)
  if (!root) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remainingStart = anchor.start
  let remainingEnd = anchor.end
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const length = Array.from(node.data).length
    if (!startNode && remainingStart <= length) {
      startNode = node
      startOffset = Array.from(node.data).slice(0, remainingStart).join('').length
    }
    if (remainingEnd <= length) {
      endNode = node
      endOffset = Array.from(node.data).slice(0, remainingEnd).join('').length
      break
    }
    remainingStart -= length
    remainingEnd -= length
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

function useAnnotationHighlights(annotations: Annotation[]) {
  useEffect(() => {
    const css = (window as Window & { CSS?: { highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void } } }).CSS
    const HighlightCtor = (window as Window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!css?.highlights || !HighlightCtor) return
    const names = ['reader-yellow', 'reader-green', 'reader-blue']
    const colors: Record<string, string> = { yellow: names[0], green: names[1], blue: names[2] }
    for (const name of names) css.highlights.delete(name)
    for (const color of ['yellow', 'green', 'blue'] as const) {
      const ranges = annotations.filter((a) => a.anchor_status === 'resolved' && a.current_anchor && a.color === color)
        .map((a) => rangeForAnchor(a.current_anchor!)).filter((value): value is Range => value !== null)
      if (ranges.length) css.highlights.set(colors[color], new HighlightCtor(...ranges))
    }
    return () => { for (const name of names) css.highlights?.delete(name) }
  }, [annotations])
}

export function ReaderWorkspace({ context, setContext, onNotice }: {
  context: ReadingContext; setContext: (next: ReadingContext | ((current: ReadingContext) => ReadingContext)) => void
  onNotice: (message: string, error?: boolean) => void
}) {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<'notes' | 'ai'>('notes')
  const [selection, setSelection] = useState<TextAnchor | null>(null)
  const [toolbarPosition, setToolbarPosition] = useState({ left: 24, top: 76 })
  const [reanchorTarget, setReanchorTarget] = useState<Annotation | null>(null)
  const [comment, setComment] = useState('')
  const [color, setColor] = useState<'yellow' | 'green' | 'blue'>('yellow')
  const [busy, setBusy] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [editing, setEditing] = useState<PersonalNote | null>(null)
  const [noteStatus, setNoteStatus] = useState('')
  const [staleDraft, setStaleDraft] = useState<{ title?: string; body_md?: string; revision?: number } | null>(null)
  const [action, setAction] = useState<'summary' | 'explain' | 'key_points' | null>(null)
  const [job, setJob] = useState<ReadingAIJob | null>(null)
  const [results, setResults] = useState<ReadingAIResult[]>(context.ai_results)
  const [currentResult, setCurrentResult] = useState<ReadingAIResult | null>(null)
  const [pendingExplain, setPendingExplain] = useState<TextAnchor | null>(null)
  const saveTimer = useRef<number | null>(null)
  useEffect(() => {
    return () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current) }
  }, [])

  const editingRef = useRef<PersonalNote | null>(null)
  const pendingSave = useRef<{ title: string; body_md: string } | null>(null)
  const saving = useRef(false)
  const latestDraft = useRef({ title: '', body_md: '' })
  const annotations = context.annotations
  useAnnotationHighlights(annotations)

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
  }, [])

  useEffect(() => {
    const noteId = searchParams.get('note')
    if (noteId) {
      const note = context.notes.find((item) => item.id === noteId)
      if (note) {
        editingRef.current = note
        latestDraft.current = { title: note.title, body_md: note.body_md }
        setEditing(note); setDraftTitle(note.title); setDraftBody(note.body_md); setTab('notes')
      }
    }
    const annotationId = searchParams.get('annotation')
    if (annotationId) {
      const annotation = context.annotations.find((item) => item.id === annotationId)
      if (annotation) {
        setTab('notes')
        if (annotation.current_anchor) {
          window.setTimeout(() => {
            document.querySelector(`[data-reading-block-id="${CSS.escape(annotation.current_anchor!.block_id)}"]`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 250)
        }
      }
    }
  }, [context.content_id, context.notes, context.annotations, searchParams])

  const syncContext = useCallback(async () => {
    const next = await api.readingContext(context.content_id)
    setContext(next)
    setResults(next.ai_results)
  }, [context.content_id, setContext])

  useEffect(() => {
    if (!context.revision_id) return
    let active = true
    const onSelection = (event: Event) => {
      if (!active) return
      // Focusing the comment input collapses the browser selection. Keep the
      // already captured anchor while the user interacts with the toolbar.
      if (event.target instanceof Element && event.target.closest('.selection-toolbar')) return
      const next = anchorFromSelection(context)
      setSelection(next)
      if (next) {
        const range = window.getSelection()?.getRangeAt(0)
        const rect = range?.getBoundingClientRect()
        if (rect) setToolbarPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 500)), top: Math.max(72, rect.top - 54) })
      }
    }
    document.addEventListener('mouseup', onSelection)
    document.addEventListener('keyup', onSelection)
    document.addEventListener('touchend', onSelection)
    return () => {
      active = false
      document.removeEventListener('mouseup', onSelection)
      document.removeEventListener('keyup', onSelection)
      document.removeEventListener('touchend', onSelection)
    }
  }, [context])

  useEffect(() => {
    if (job?.status === 'completed' && job.result_id) {
      let active = true
      api.readingAIResult(job.result_id).then((result) => {
        if (active) {
          setCurrentResult(result)
          setResults((items) => [result, ...items.filter((item) => item.id !== result.id)])
        }
      }).catch((error) => { if (active) onNotice((error as Error).message, true) })
      return () => { active = false }
    }
    if (!job || !['queued', 'running'].includes(job.status)) return
    let active = true
    const poll = async () => {
      try {
        const next = await api.readingAIJob(job.id)
        if (!active) return
        setJob(next)
        if (next.status === 'completed' && next.result_id) {
          const result = await api.readingAIResult(next.result_id)
          if (active) {
            setCurrentResult(result)
            setResults((items) => [result, ...items.filter((item) => item.id !== result.id)])
            onNotice('AI 阅读结果已保存')
          }
        } else if (['failed', 'cancelled', 'interrupted'].includes(next.status)) {
          onNotice(next.error_message || `AI 任务${next.status}`, true)
        }
      } catch (error) { if (active) onNotice((error as Error).message, true) }
    }
    void poll()
    const timer = window.setInterval(poll, 1500)
    return () => { active = false; window.clearInterval(timer) }
  }, [job?.id, job?.status])

  const createHighlight = async () => {
    if (!selection || !context.revision_id) return
    setBusy(true)
    try {
      if (reanchorTarget) {
        const updated = await api.reanchorAnnotation(reanchorTarget.id, {
          revision: reanchorTarget.revision, revision_id: context.revision_id, anchor: selection,
        })
        setContext((current) => ({ ...current, annotations: current.annotations.map((item) => item.id === updated.id ? updated : item) }))
        setReanchorTarget(null); setSelection(null); window.getSelection()?.removeAllRanges()
        onNotice('高亮位置已重新绑定')
        return
      }
      const created = await api.createAnnotation(context.content_id, {
        revision_id: context.revision_id, anchor: selection, color, comment_md: comment, request_key: newRequestKey(),
      })
      setContext((current) => ({ ...current, annotations: [...current.annotations, created] }))
      setSelection(null); setComment(''); window.getSelection()?.removeAllRanges()
      onNotice('高亮与批注已保存')
    } catch (error) { onNotice((error as Error).message, true) }
    finally { setBusy(false) }
  }

  const newNote = async () => {
    if (saving.current || pendingSave.current) {
      onNotice('当前笔记正在保存，请保存完成后再新建。', true)
      return
    }
    setBusy(true)
    try {
      if (saving.current || pendingSave.current) {
        onNotice('当前笔记正在保存，请保存完成后再新建。', true)
        return
      }
      const note = await api.createNote(context.content_id, { title: '', body_md: '', request_key: newRequestKey() })
      setContext((current) => ({ ...current, notes: [note, ...current.notes] }))
      editingRef.current = note
      latestDraft.current = { title: note.title, body_md: note.body_md }
      setEditing(note); setDraftTitle(note.title); setDraftBody(note.body_md); setNoteStatus('已保存')
    } catch (error) { onNotice((error as Error).message, true) }
    finally { setBusy(false) }
  }

  const flushQueued = useCallback(async () => {
    if (saving.current) return
    saving.current = true
    try {
      while (pendingSave.current) {
        const snapshot = pendingSave.current
        pendingSave.current = null
        const note = editingRef.current
        if (!note) break
        setNoteStatus('保存中…')
        try {
          const updated = await api.patchNote(note.id, { revision: note.revision, ...snapshot })
          if (editingRef.current?.id === note.id) {
            editingRef.current = updated
            setEditing(updated)
          }
          setContext((current) => ({ ...current, notes: current.notes.map((item) => item.id === updated.id ? updated : item) }))
          if (latestDraft.current.title === snapshot.title && latestDraft.current.body_md === snapshot.body_md) {
            setNoteStatus('已保存')
            localStorage.removeItem(`zhilib-draft:${context.library_id}:${context.content_id}:${note.id}`)
          }
        } catch (error) {
          pendingSave.current = null
          setNoteStatus('保存失败，草稿仍保留')
          onNotice((error as Error).message, true)
          break
        }
      }
    } finally { saving.current = false }
  }, [context.content_id, context.library_id, onNotice, setContext])

  const changeDraft = (title: string, body: string) => {
    setDraftTitle(title); setDraftBody(body); latestDraft.current = { title, body_md: body }; setNoteStatus('未保存')
    if (editing) {
      pendingSave.current = { title, body_md: body }
      localStorage.setItem(`zhilib-draft:${context.library_id}:${context.content_id}:${editing.id}`,
        JSON.stringify({ title, body_md: body, revision: editing.revision }))
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void flushQueued(), 800)
    }
  }

  const selectNote = (note: PersonalNote) => {
    if (saving.current || pendingSave.current) {
      onNotice('当前笔记正在保存，请保存完成后再切换。', true)
      return
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    editingRef.current = note
    const key = `zhilib-draft:${context.library_id}:${context.content_id}:${note.id}`
    let title = note.title, body = note.body_md
    try {
      const draft = JSON.parse(localStorage.getItem(key) || 'null') as { title?: string; body_md?: string; revision?: number } | null
      if (draft && draft.revision === note.revision && (draft.title !== title || draft.body_md !== body)) {
        setStaleDraft(null)
        title = draft.title || ''; body = draft.body_md || ''
        pendingSave.current = { title, body_md: body }
        window.setTimeout(() => void flushQueued(), 0)
        setNoteStatus('已恢复本地草稿，正在保存')
      } else {
        pendingSave.current = null
        setStaleDraft(draft && draft.revision !== note.revision ? draft : null)
        if (draft && draft.revision !== note.revision) setNoteStatus('检测到基于旧版本的本地草稿，请核对后恢复')
        else setNoteStatus('已保存')
      }
    } catch { setNoteStatus('已保存') }
    latestDraft.current = { title, body_md: body }
    setEditing(note); setDraftTitle(title); setDraftBody(body)
  }

  const removeCurrentNote = async () => {
    if (!editing) return
    if (saving.current || pendingSave.current) {
      onNotice('当前笔记正在保存，请保存完成后再删除。', true)
      return
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    try {
      await api.deleteNote(editing.id, editing.revision)
      localStorage.removeItem(`zhilib-draft:${context.library_id}:${context.content_id}:${editing.id}`)
      editingRef.current = null; pendingSave.current = null; setEditing(null)
      setContext((current) => ({ ...current, notes: current.notes.filter((item) => item.id !== editing.id) }))
      setNoteStatus('')
    } catch (error) { onNotice((error as Error).message, true) }
  }

  const exportReadingData = async () => {
    try {
      const blob = await api.exportReadingData(context.content_id)
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href; link.download = `reading-${context.content_id}.json`; link.click()
      URL.revokeObjectURL(href)
      onNotice('已导出本篇文章的笔记、标注和 AI 结果')
    } catch (error) { onNotice((error as Error).message, true) }
  }

  const importReadingData = async (file?: File) => {
    if (!file) return
    try {
      const data = JSON.parse(await file.text()) as unknown
      const preview = await api.previewReadingImport(context.content_id, data)
      const accepted = window.confirm(`将恢复 ${preview.annotations} 条高亮、${preview.notes} 条笔记和 ${preview.ai_results} 条 AI 结果到本篇文章。是否继续？`)
      if (!accepted) return
      await api.importReadingData(context.content_id, data)
      await syncContext()
      onNotice('阅读记录已恢复')
    } catch (error) { onNotice((error as Error).message, true) }
  }

  const startAI = async (nextAction: 'summary' | 'explain' | 'key_points', explainAnchor?: TextAnchor, forceRegenerate = false) => {
    if (!context.revision_id) { onNotice('正文不可用，无法开始 AI 阅读', true); return }
    const anchor = explainAnchor || pendingExplain
    if (nextAction === 'explain' && !anchor) { onNotice('请先在正文中选择一段文字', true); return }
    setAction(nextAction); setTab('ai'); setCurrentResult(null); setJob(null)
    try {
      const response = await api.createReadingAIJob(context.content_id, {
        action: nextAction, revision_id: context.revision_id, selection_anchor: anchor,
        force: forceRegenerate, request_key: newRequestKey(),
      })
      if (response.kind === 'result' && response.result) setCurrentResult(response.result)
      else if (response.id) setJob(await api.readingAIJob(response.id))
    } catch (error) { onNotice((error as Error).message, true) }
  }

  const saveAIAsNote = async (result: ReadingAIResult) => {
    try {
      const note = await api.convertAIResultToNote(result.id, { request_key: newRequestKey(), title: `AI ${result.action === 'summary' ? '全文总结' : result.action === 'explain' ? '段落解释' : '文章要点'}` })
      setContext((current) => ({ ...current, notes: [note, ...current.notes] }))
      onNotice('已转存为个人笔记')
    } catch (error) { onNotice((error as Error).message, true) }
  }

  const removeAnnotation = async (annotation: Annotation) => {
    try {
      await api.deleteAnnotation(annotation.id, annotation.revision)
      setContext((current) => ({ ...current, annotations: current.annotations.filter((item) => item.id !== annotation.id) }))
    } catch (error) { onNotice((error as Error).message, true) }
  }

  const locate = (annotation: Annotation) => {
    const anchor = annotation.current_anchor
    if (!anchor) { onNotice('这条高亮在当前正文中无法定位', true); return }
    const range = rangeForAnchor(anchor)
    if (!range) { onNotice('正文显示结构与引用不一致', true); return }
    const block = document.querySelector(`[data-reading-block-id="${CSS.escape(anchor.block_id)}"]`)
    block?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const actions = useMemo(() => [
    ['summary', '总结全文'], ['explain', '解释选段'], ['key_points', '提取要点'],
  ] as const, [])

  return <section className="reading-workspace">
        {selection && <div className="selection-toolbar selection-toolbar-floating" style={{ left: toolbarPosition.left, top: toolbarPosition.top }} role="toolbar" aria-label="选中文字操作">
      {reanchorTarget ? <><span>为这条高亮重新选择原文</span><button className="button button-primary" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => void createHighlight()}><Highlighter size={14} />确认重新绑定</button><button onClick={() => setReanchorTarget(null)}>取消</button></> : <><button className="button button-soft" onMouseDown={(event) => event.preventDefault()} onClick={() => { setPendingExplain(selection); void startAI('explain', selection) }}><Sparkles size={14} />解释这段</button>
      <select aria-label="高亮颜色" value={color} onChange={(event) => setColor(event.target.value as typeof color)}><option value="yellow">黄色</option><option value="green">绿色</option><option value="blue">蓝色</option></select>
      <input aria-label="批注内容" placeholder="添加批注（可选）" value={comment} onChange={(event) => setComment(event.target.value)} />
      <button className="button button-primary" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => void createHighlight()}><Highlighter size={14} />保存高亮与批注</button></>}
    </div>}
    <div className="reading-workspace-tabs"><button className={tab === 'notes' ? 'selected' : ''} onClick={() => setTab('notes')}>高亮与笔记 <span>{annotations.length + context.notes.length}</span></button><button className={tab === 'ai' ? 'selected' : ''} onClick={() => setTab('ai')}><Sparkles size={14} /> AI 阅读助手</button></div>
    {tab === 'notes' ? <div className="reading-notes-panel">
      <div className="reading-panel-heading"><div><strong>留下自己的理解</strong><small>笔记会保存在本地资料库</small></div><div className="reading-data-actions"><button className="button button-soft" onClick={() => void exportReadingData()}>导出阅读记录</button><label className="button button-soft">恢复记录<input type="file" accept="application/json,.json" hidden onChange={(event) => { void importReadingData(event.target.files?.[0]); event.currentTarget.value = '' }} /></label><button className="button button-soft" disabled={busy} onClick={() => void newNote()}><Plus size={14} />新建笔记</button></div></div>
      {editing && <div className="personal-note-editor">{staleDraft && <div className="stale-note-draft"><strong>旧版本草稿</strong><p>{staleDraft.title || ''}</p><pre>{staleDraft.body_md || ''}</pre><button className="button button-soft" onClick={() => { setStaleDraft(null); changeDraft(staleDraft.title || '', staleDraft.body_md || '') }}>恢复此草稿</button></div>}<input value={draftTitle} onChange={(event) => changeDraft(event.target.value, draftBody)} placeholder="笔记标题（可选）" /><textarea value={draftBody} onChange={(event) => changeDraft(draftTitle, event.target.value)} placeholder="写下你的理解、问题或行动计划…" rows={7} /><details><summary>预览 Markdown 与知识链接</summary><WikiMarkdown text={draftBody} /></details><div className="note-save-status"><span>{noteStatus}</span><div><button className="button button-soft" disabled={noteStatus === '保存中…'} onClick={() => void flushQueued()}><Save size={13} />立即保存</button><button className="button button-soft" onClick={() => void removeCurrentNote()}><Trash2 size={13} />删除</button></div></div></div>}
      <div className="reading-record-list">
        {annotations.map((item) => <article className="reading-record-card" key={item.id}>
          <div className="record-quote" onClick={() => locate(item)}><span className={`annotation-swatch ${item.color}`} />“{item.current_anchor?.exact || item.original_anchor.exact}”</div>
          {item.comment_md && <p>{item.comment_md}</p>}
          {item.anchor_status !== 'resolved' && <small className="anchor-warning">原文位置{item.anchor_status === 'ambiguous' ? '不明确' : '已失效'}</small>}
          <div className="record-actions"><button onClick={() => locate(item)}>定位原文</button>{item.anchor_status !== 'resolved' && <button onClick={() => { setReanchorTarget(item); onNotice('请在正文中重新选择对应文字') }}>重新绑定</button>}<button aria-label="删除高亮" onClick={() => void removeAnnotation(item)}><Trash2 size={13} /></button></div>
        </article>)}
        {context.notes.map((note) => <article className="reading-record-card" key={note.id}>
          <button className="record-note-title" onClick={() => selectNote(note)}>{note.title || '未命名笔记'}</button>
          <p className="record-note-preview">{note.body_md.slice(0, 260) || '空白笔记'}</p>
          {note.origin_ai_result_id && <small>从 AI 结果转存</small>}
        </article>)}
        {!annotations.length && !context.notes.length && !editing && <p className="reading-empty">选中一段文字添加高亮，或新建一篇个人笔记。</p>}
      </div>
    </div> : <div className="reading-ai-panel">
      <div className="reading-panel-heading"><div><strong>只分析当前文章</strong><small>提交后按当前正文版本调用已配置的模型，并保存结果</small></div></div>
      <div className="reading-ai-actions">{actions.map(([key, label]) => <button className="button button-soft" key={key} disabled={!context.revision_id || Boolean(job && ['queued', 'running'].includes(job.status))} onClick={() => void startAI(key)}><Sparkles size={14} />{label}</button>)}</div>
      {job && <div className="reading-ai-progress"><LoaderCircle size={15} className={['queued','running'].includes(job.status) ? 'spin' : ''} /><span>{job.status === 'running' ? `正在处理 ${job.completed_steps}/${job.total_steps}` : job.status === 'queued' ? '等待开始' : job.error_message || job.status}</span>{['queued','running'].includes(job.status) && <button onClick={() => void api.cancelReadingAIJob(job.id).then(setJob)}>取消</button>}{['failed','interrupted'].includes(job.status) && <button onClick={() => void api.retryReadingAIJob(job.id).then((result) => setJob({ ...job, id: result.id, status: result.status }))}>重试</button>}</div>}
      {currentResult && <div className="reading-ai-result"><div className="reading-result-actions"><strong>已保存的 AI 结果 {currentResult.revision_id !== context.revision_id && <small>基于旧正文版本</small>}</strong><button className="button button-soft" onClick={() => void saveAIAsNote(currentResult)}>保存为个人笔记</button><button onClick={() => void api.deleteReadingAIResult(currentResult.id).then(() => { setCurrentResult(null); void syncContext() })} aria-label="删除结果"><Trash2 size={14} /></button><button className="button button-soft" onClick={() => action && void startAI(action, pendingExplain || undefined, true)}><RefreshCw size={13} />重新生成</button></div><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{currentResult.rendered_md}</ReactMarkdown></div><details className="reading-ai-citations"><summary>查看原文依据</summary>{Object.entries(JSON.parse(currentResult.citations_json || '{}') as Record<string, { text?: string }>).map(([id, citation]) => <p key={id}><b>[{id}]</b> {citation.text || ''}</p>)}</details></div>}
      {results.length > 0 && <div className="reading-ai-history"><strong>历史结果</strong>{results.map((result) => <button key={result.id} onClick={() => setCurrentResult(result)}>{result.action === 'summary' ? '全文总结' : result.action === 'explain' ? '段落解释' : '文章要点'} · {new Date(result.created_at).toLocaleString()} <ArrowRight size={13} /></button>)}</div>}
      {!context.revision_id && <p className="reading-empty">正文文件暂时不可用。已有笔记仍可查看。</p>}
    </div>}
  </section>
}
