import type {ReactNode} from 'react'
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog'
import {Button} from '@astryxdesign/core/Button'
import {VStack} from '@astryxdesign/core/VStack'
import {HStack} from '@astryxdesign/core/HStack'
import {Banner} from '@astryxdesign/core/Banner'

export function ConfirmActionDialog({title, children, confirmLabel, cancelLabel = '取消', busy = false, error, onCancel, onConfirm}: {
  title: string; children: ReactNode; confirmLabel: string; cancelLabel?: string;
  busy?: boolean; error?: string; onCancel: () => void; onConfirm: () => void;
}) {
  return <Dialog isOpen onOpenChange={open => { if (!open && !busy) onCancel() }} purpose={busy ? 'required' : 'form'} width="min(100%, 36rem)">
    <VStack gap={5}>
      <DialogHeader title={title} onOpenChange={busy ? undefined : () => onCancel()} />
      {children}
      {error && <Banner title={error} status="error" />}
      <HStack gap={3} hAlign="end" wrap="wrap">
        <Button label={cancelLabel} isDisabled={busy} onClick={onCancel} data-autofocus />
        <Button label={confirmLabel} variant="destructive" isLoading={busy} onClick={onConfirm} />
      </HStack>
    </VStack>
  </Dialog>
}
