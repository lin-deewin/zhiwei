import {VStack} from '@astryxdesign/core/VStack'
import {Text} from '@astryxdesign/core/Text'
import {ConfirmActionDialog} from './shared/ConfirmActionDialog'

export function DeleteArticleDialog({title, busy, error, onCancel, onConfirm}: {
  title: string; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void;
}) {
  return <ConfirmActionDialog title="删除这篇文章？" confirmLabel="确认删除" cancelLabel="暂不删除" busy={busy} error={error} onCancel={onCancel} onConfirm={onConfirm}>
    <VStack gap={3}>
      <Text weight="semibold">{title}</Text>
      <Text>本地 Markdown、图片和元数据将永久删除，无法撤销。</Text>
      <Text>这篇文章的高亮、批注、个人笔记和 AI 阅读结果也会一并删除。</Text>
      <Text>之后的增量和全量同步都会跳过这篇文章。知乎上的收藏会保留。</Text>
    </VStack>
  </ConfirmActionDialog>
}
