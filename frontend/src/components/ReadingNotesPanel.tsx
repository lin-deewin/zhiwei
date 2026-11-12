import { Plus, Save, Trash2 } from 'lucide-react'
import type { Annotation, PersonalNote, ReadingContext } from '../types'
import { WikiMarkdown } from './WikiMarkdown'

type StaleDraft = { title?: string; body_md?: string; revision?: number }

type ReadingNotesPanelProps = {
  context: ReadingContext
  annotations: Annotation[]
  editing: PersonalNote | null
  staleDraft: StaleDraft | null
  draftTitle: string
  draftBody: string
  noteStatus: string
  busy: boolean
  onExport: () => void
  onImport: (file?: File) => void
  onNewNote: () => void
  onDraftChange: (title: string, body: string) => void
  onRestoreDraft: () => void
  onFlush: () => void
  onDeleteCurrent: () => void
  onLocate: (annotation: Annotation) => void
  onReanchor: (annotation: Annotation) => void
  onRemoveAnnotation: (annotation: Annotation) => void
  onSelectNote: (note: PersonalNote) => void
}

export function ReadingNotesPanel({
  context, annotations, editing, staleDraft, draftTitle, draftBody, noteStatus, busy,
  onExport, onImport, onNewNote, onDraftChange, onRestoreDraft, onFlush,
  onDeleteCurrent, onLocate, onReanchor, onRemoveAnnotation, onSelectNote,
}: ReadingNotesPanelProps) {
  return <div className="reading-notes-panel">
    <div className="reading-panel-heading">
      <div><strong>留下自己的理解</strong><small>笔记会保存在本地资料库</small></div>
      <div className="reading-data-actions">
        <button className="button button-soft" onClick={onExport}>导出阅读记录</button>
        <label className="button button-soft">恢复记录<input type="file" accept="application/json,.json" hidden onChange={(event) => { onImport(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
        <button className="button button-soft" disabled={busy} onClick={onNewNote}><Plus size={14} />新建笔记</button>
      </div>
    </div>
    {editing && <div className="personal-note-editor">
      {staleDraft && <div className="stale-note-draft">
        <strong>旧版本草稿</strong><p>{staleDraft.title || ''}</p><pre>{staleDraft.body_md || ''}</pre>
        <button className="button button-soft" onClick={onRestoreDraft}>恢复此草稿</button>
      </div>}
      <input value={draftTitle} onChange={(event) => onDraftChange(event.target.value, draftBody)} placeholder="笔记标题（可选）" />
      <textarea value={draftBody} onChange={(event) => onDraftChange(draftTitle, event.target.value)} placeholder="写下你的理解、问题或行动计划…" rows={7} />
      <details><summary>预览 Markdown 与知识链接</summary><WikiMarkdown text={draftBody} /></details>
      <div className="note-save-status">
        <span>{noteStatus}</span>
        <div>
          <button className="button button-soft" disabled={noteStatus === '保存中…'} onClick={onFlush}><Save size={13} />立即保存</button>
          <button className="button button-soft" onClick={onDeleteCurrent}><Trash2 size={13} />删除</button>
        </div>
      </div>
    </div>}
    <div className="reading-record-list">
      {annotations.map((item) => <article className="reading-record-card" key={item.id}>
        <button type="button" className="record-quote" onClick={() => onLocate(item)}><span className={'annotation-swatch ' + item.color} />“{item.current_anchor?.exact || item.original_anchor.exact}”</button>
        {item.comment_md && <p>{item.comment_md}</p>}
        {item.anchor_status !== 'resolved' && <small className="anchor-warning">原文位置{item.anchor_status === 'ambiguous' ? '不明确' : '已失效'}</small>}
        <div className="record-actions">
          <button onClick={() => onLocate(item)}>定位原文</button>
          {item.anchor_status !== 'resolved' && <button onClick={() => onReanchor(item)}>重新绑定</button>}
          <button aria-label="删除高亮" onClick={() => onRemoveAnnotation(item)}><Trash2 size={13} /></button>
        </div>
      </article>)}
      {context.notes.map((note) => <article className="reading-record-card" key={note.id}>
        <button className="record-note-title" onClick={() => onSelectNote(note)}>{note.title || '未命名笔记'}</button>
        <p className="record-note-preview">{note.body_md.slice(0, 260) || '空白笔记'}</p>
        {note.origin_ai_result_id && <small>从 AI 结果转存</small>}
      </article>)}
      {!annotations.length && !context.notes.length && !editing && <p className="reading-empty">选中一段文字添加高亮，或新建一篇个人笔记。</p>}
    </div>
  </div>
}
