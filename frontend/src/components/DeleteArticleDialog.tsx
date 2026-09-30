import { useEffect, useRef } from 'react'
import { FileText, LoaderCircle, Trash2, X } from 'lucide-react'

export function DeleteArticleDialog({ title, busy, error, onCancel, onConfirm }: {
  title: string; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    cancelRef.current?.focus()
    return () => dialog?.close()
  }, [])

  return <dialog ref={dialogRef} className="delete-article-dialog" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
    <button className="delete-dialog-close" aria-label="关闭删除确认" disabled={busy} onClick={onCancel}><X size={18} /></button>
    <div className="delete-dialog-icon"><Trash2 size={24} /></div>
    <h2 id="delete-dialog-title">删除这篇文章？</h2>
    <p id="delete-dialog-description">删除后无法撤销，请确认这篇文章不再需要。</p>
    <div className="delete-dialog-article"><FileText size={19} /><strong>{title}</strong></div>
    <div className="delete-dialog-details">
      <p>本地 Markdown、图片和元数据将永久删除。</p>
      <p>之后的增量和全量同步都会跳过这篇文章。</p>
      <span>知乎上的收藏会保留。</span>
    </div>
    {error && <p className="delete-dialog-error" role="alert">{error}</p>}
    <div className="delete-dialog-actions">
      <button ref={cancelRef} className="button delete-dialog-cancel" disabled={busy} onClick={onCancel}>暂不删除</button>
      <button className="button delete-dialog-confirm" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}{busy ? '正在删除…' : '确认删除'}</button>
    </div>
  </dialog>
}
