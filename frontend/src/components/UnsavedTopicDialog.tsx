import {Text} from '@astryxdesign/core/Text'
import {ConfirmActionDialog} from './shared/ConfirmActionDialog'

export function UnsavedTopicDialog({title, onCancel, onConfirm}: {
  title: string; onCancel: () => void; onConfirm: () => void;
}) {
  return <ConfirmActionDialog title="当前主题还有未保存的修改" confirmLabel="放弃修改并切换" cancelLabel="返回编辑" onCancel={onCancel} onConfirm={onConfirm}>
    <Text>「{title}」尚未保存。切换后，这些修改将丢失，请先保存或确认放弃。</Text>
  </ConfirmActionDialog>
}
