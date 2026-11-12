import {Toast} from '@astryxdesign/core/Toast'
import {VStack} from '@astryxdesign/core/VStack'
import type {Notice} from '../../types/ui'

// Keep the single application notice inside Theme so it follows reading mode.
export function NoticeFeedback({notice, onDismiss}: {notice: Notice; onDismiss: () => void}) {
  if (!notice) return null
  return <VStack className="notice-viewport" role="status" aria-live={notice.error ? 'assertive' : 'polite'}>
    <Toast key={notice.message} body={notice.message} type={notice.error ? 'error' : 'info'} isAutoHide={!notice.error} autoHideDuration={5000} onDismiss={onDismiss} />
  </VStack>
}
