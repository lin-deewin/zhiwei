import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { api } from '../api'
import { anchorFromSelection, rangeForAnchor } from '../utils/reading_anchors'
import { useAnnotationHighlights } from '../hooks/useAnnotationHighlights'
import { ReadingNotesPanel } from './ReadingNotesPanel'
import { ReadingAIPanel } from './ReadingAIPanel'
import { ReadingSelectionToolbar } from './ReadingSelectionToolbar'
import { newRequestKey } from '../utils/request_key'
import type { Annotation, PersonalNote, ReadingAIJob, ReadingAIResult, ReadingContext, TextAnchor } from '../types'


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

  const cancelAIJob = async () => {
    if (!job) return
    try { setJob(await api.cancelReadingAIJob(job.id)) }
    catch (error) { onNotice((error as Error).message, true) }
  }

  const retryAIJob = async () => {
    if (!job) return
    try {
      const retried = await api.retryReadingAIJob(job.id)
      setJob({ ...job, id: retried.id, status: retried.status })
    } catch (error) { onNotice((error as Error).message, true) }
  }

  const deleteAIResult = async () => {
    if (!currentResult) return
    try {
      await api.deleteReadingAIResult(currentResult.id)
      setCurrentResult(null)
      await syncContext()
    } catch (error) { onNotice((error as Error).message, true) }
  }

  const actions = useMemo(() => [
    ['summary', '总结全文'], ['explain', '解释选段'], ['key_points', '提取要点'],
  ] as const, [])

  return <section className="reading-workspace">
    <ReadingSelectionToolbar
      selection={selection}
      position={toolbarPosition}
      reanchorTarget={reanchorTarget}
      busy={busy}
      color={color}
      comment={comment}
      onColorChange={setColor}
      onCommentChange={setComment}
      onExplain={() => { if (selection) { setPendingExplain(selection); void startAI('explain', selection) } }}
      onSave={() => void createHighlight()}
      onCancelReanchor={() => setReanchorTarget(null)}
    />
    <div className="reading-workspace-tabs" role="group" aria-label="阅读工作区">
      <button type="button" aria-pressed={tab === 'notes'} className={tab === 'notes' ? 'selected' : ''} onClick={() => setTab('notes')}>高亮与笔记 <span>{annotations.length + context.notes.length}</span></button>
      <button type="button" aria-pressed={tab === 'ai'} className={tab === 'ai' ? 'selected' : ''} onClick={() => setTab('ai')}><Sparkles size={14} /> AI 阅读助手</button>
    </div>
    <div className="reading-workspace-panel" role="region" aria-label={tab === 'notes' ? '高亮与笔记' : 'AI 阅读助手'}>
    {tab === 'notes'
      ? <ReadingNotesPanel
          context={context}
          annotations={annotations}
          editing={editing}
          staleDraft={staleDraft}
          draftTitle={draftTitle}
          draftBody={draftBody}
          noteStatus={noteStatus}
          busy={busy}
          onExport={() => void exportReadingData()}
          onImport={(file) => void importReadingData(file)}
          onNewNote={() => void newNote()}
          onDraftChange={changeDraft}
          onRestoreDraft={() => {
            if (!staleDraft) return
            setStaleDraft(null)
            changeDraft(staleDraft.title || '', staleDraft.body_md || '')
          }}
          onFlush={() => void flushQueued()}
          onDeleteCurrent={() => void removeCurrentNote()}
          onLocate={locate}
          onReanchor={(item) => { setReanchorTarget(item); onNotice('请在正文中重新选择对应文字') }}
          onRemoveAnnotation={(item) => void removeAnnotation(item)}
          onSelectNote={selectNote}
        />
      : <ReadingAIPanel
          context={context}
          actions={actions}
          action={action}
          job={job}
          results={results}
          currentResult={currentResult}
          onStart={(key) => void startAI(key)}
          onCancel={() => void cancelAIJob()}
          onRetry={() => void retryAIJob()}
          onDeleteResult={() => void deleteAIResult()}
          onRegenerate={() => { if (action) void startAI(action, pendingExplain || undefined, true) }}
          onSaveAsNote={(result) => void saveAIAsNote(result)}
          onSelectResult={setCurrentResult}
        />
    }
    </div>
  </section>
}
