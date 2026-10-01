import { useEffect, useRef } from 'react'
import { FilePenLine, FileText, X } from 'lucide-react'

export function UnsavedTopicDialog({ title, onCancel, onConfirm }: {
  title: string; onCancel: () => void; onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    cancelRef.current?.focus()
    return () => dialog?.close()
  }, [])

  return <dialog ref={dialogRef} className="delete-article-dialog unsaved-topic-dialog" aria-labelledby="unsaved-topic-title" aria-describedby="unsaved-topic-description" onCancel={(event) => { event.preventDefault(); onCancel() }}>
    <button className="delete-dialog-close" aria-label="关闭切换确认" onClick={onCancel}><X size={18} /></button>
    <div className="delete-dialog-icon"><FilePenLine size={24} /></div>
    <h2 id="unsaved-topic-title">当前主题还有未保存的修改</h2>
    <p id="unsaved-topic-description">切换后，这些修改将丢失。你可以返回编辑，保存后再切换。</p>
    <div className="delete-dialog-article"><FileText size={19} /><strong>{title}</strong></div>
    <div className="delete-dialog-actions">
      <button ref={cancelRef} className="button delete-dialog-cancel" onClick={onCancel}>返回编辑</button>
      <button className="button delete-dialog-confirm" onClick={onConfirm}>放弃修改并切换</button>
    </div>
  </dialog>
}
