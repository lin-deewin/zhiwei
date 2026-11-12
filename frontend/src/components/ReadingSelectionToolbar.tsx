import {Button} from '@astryxdesign/core/Button'
import {Selector} from '@astryxdesign/core/Selector'
import {TextInput} from '@astryxdesign/core/TextInput'
import { FilePlus2, Highlighter, Sparkles } from 'lucide-react'
import type { Annotation, TextAnchor } from '../types'

type ReadingSelectionToolbarProps = {
  selection: TextAnchor | null
  position: { left: number; top: number }
  reanchorTarget: Annotation | null
  busy: boolean
  color: 'yellow' | 'green' | 'blue'
  comment: string
  onColorChange: (color: 'yellow' | 'green' | 'blue') => void
  onCommentChange: (comment: string) => void
  onExplain: () => void
  onCreateNote: () => void
  onSave: () => void
  onCancelReanchor: () => void
}

export function ReadingSelectionToolbar({
  selection, position, reanchorTarget, busy, color, comment, onColorChange,
  onCommentChange, onExplain, onCreateNote, onSave, onCancelReanchor,
}: ReadingSelectionToolbarProps) {
  if (!selection) return null
  return <div className="selection-toolbar selection-toolbar-floating" style={{ left: position.left, top: position.top }} role="toolbar" aria-label="选中文字操作">
    {reanchorTarget
      ? <>
        <span>为这条高亮重新选择原文</span>
        <Button label="确认重新绑定" icon={<Highlighter />} variant="primary"   isDisabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={onSave} />
        <button onClick={onCancelReanchor}>取消</button>
      </>
      : <>
        <Button label="解释这段" icon={<Sparkles />} variant="secondary"   onMouseDown={(event) => event.preventDefault()} onClick={onExplain} />
        <Button label="转为个人笔记" icon={<FilePlus2 />} variant="secondary"   isDisabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={onCreateNote} />
        <Selector label="高亮颜色" options={[({value:String("yellow"),label:"黄色"}),({value:String("green"),label:"绿色"}),({value:String("blue"),label:"蓝色"})]} value={String(color)} onChange={value => onColorChange(value as typeof color)} />
        <TextInput label="批注内容" width="100%" aria-label="批注内容" placeholder="添加批注（可选）" value={comment} onChange={(_value, event) => onCommentChange(event.target.value)} />
        <Button label="保存高亮与批注" icon={<Highlighter />} variant="primary"   isDisabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={onSave} />
      </>}
  </div>
}
