import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react'
import {Text} from '@astryxdesign/core/Text'
import {ConfirmActionDialog} from './ConfirmActionDialog'

const Context = createContext<((message: string) => Promise<boolean>) | null>(null)
export function ConfirmationProvider({children}: {children: ReactNode}) {
  const [message, setMessage] = useState<string | null>(null)
  const pending = useRef<((answer: boolean) => void) | null>(null)
  const confirm = useCallback((text: string) => {
    // Deduplicate a second action while a confirmation is already visible.
    if (pending.current) return Promise.resolve(false)
    setMessage(text)
    return new Promise<boolean>(resolve => { pending.current = resolve })
  }, [])
  const settle = (answer: boolean) => {
    const resolve = pending.current
    pending.current = null
    setMessage(null)
    resolve?.(answer)
  }
  useEffect(() => () => { pending.current?.(false); pending.current = null }, [])
  return <Context.Provider value={confirm}>{children}{message && <ConfirmActionDialog title="确认操作" confirmLabel="确认继续" cancelLabel="返回" onCancel={() => settle(false)} onConfirm={() => settle(true)}><Text>{message}</Text></ConfirmActionDialog>}</Context.Provider>
}
export function useConfirm() {
  const confirm = useContext(Context)
  if (!confirm) throw new Error('ConfirmationProvider is required')
  return confirm
}
