import {useEffect, useRef} from 'react'
import {useToast} from '@astryxdesign/core/Toast'
import type {Notice} from '../../types/ui'

export function NoticeFeedback({notice, onDismiss}: {notice: Notice; onDismiss: () => void}) {
  const toast = useToast()
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    if (!notice) return
    toast({body: notice.message, type: notice.error ? 'error' : 'info', uniqueID: 'library-notice', isAutoHide: !notice.error})
    dismiss.current()
  }, [notice, toast])
  return null
}
