import {useEffect} from 'react'
import {useNavigate} from 'react-router-dom'
import {useConfirm} from '../components/shared/ConfirmationProvider'

export function useUnsavedLinkGuard(dirty: boolean, message: string) {
  const confirm = useConfirm()
  const navigate = useNavigate()
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const guard = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a') : null
      if (!link || link.target === '_blank' || link.origin !== window.location.origin) return
      if (link.pathname === window.location.pathname && link.search === window.location.search) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const destination = link.pathname + link.search + link.hash
      void confirm(message).then(accepted => { if (accepted) navigate(destination) })
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', guard, true)
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guard, true) }
  }, [dirty, message, confirm, navigate])
}
