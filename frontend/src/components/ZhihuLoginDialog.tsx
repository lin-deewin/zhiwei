import {TextInput} from '@astryxdesign/core/TextInput'
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog'
import {VStack} from '@astryxdesign/core/VStack'
import {Button} from '@astryxdesign/core/Button'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { api } from '../api'
import type { LoginEvent, LoginFrame, LoginStatus } from '../api'

type Props = { onClose: () => void; onConnected: () => void }
const STORAGE_KEY = 'zhilib.login.task'
const REQUEST_KEY = 'zhilib.login.request'

function newRequestId(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前浏览器无法生成安全登录标识，请更新浏览器后重试。')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function ZhihuLoginDialog({ onClose, onConnected }: Props) {
  const [status, setStatus] = useState<LoginStatus | null>(null)
  const [frame, setFrame] = useState<LoginFrame | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [zoom, setZoom] = useState(false)
  const [verificationText, setVerificationText] = useState('')
  const owner = useRef<{ id: string; token: string } | null>(null)
  const live = useRef(true)
  const inputChain = useRef(Promise.resolve())
  const lastMove = useRef(0)

  useEffect(() => {
    live.current = true
    const begin = async () => {
      try {
        let requestId = sessionStorage.getItem(REQUEST_KEY)
        if (!requestId) {
          requestId = newRequestId()
          sessionStorage.setItem(REQUEST_KEY, requestId)
        }
        const stored = sessionStorage.getItem(STORAGE_KEY)
        let result: LoginStatus
        if (stored) {
          try {
            const saved = JSON.parse(stored) as { id: string; token: string }
            result = await api.browserLoginStatus(saved.id, saved.token)
            owner.current = saved
          } catch {
            sessionStorage.removeItem(STORAGE_KEY)
            result = await api.startBrowserLogin(requestId)
          }
        } else result = await api.startBrowserLogin(requestId)
        if (!live.current) return
        if (result.login_id && result.control_token) {
          owner.current = { id: result.login_id, token: result.control_token }
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(owner.current))
        }
        setStatus(result)
        if (result.state === 'connected') { sessionStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(REQUEST_KEY); onConnected() }
      } catch (problem) {
        if (!live.current) return
        try {
          if ((await api.account()).status === 'connected') {
            sessionStorage.removeItem(STORAGE_KEY)
            sessionStorage.removeItem(REQUEST_KEY)
            onConnected()
            return
          }
        } catch { /* Keep the original login error. */ }
        setError((problem as Error).message)
      }
      finally { if (live.current) setBusy(false) }
    }
    void begin()
    return () => { live.current = false }
  }, [onConnected])

  useEffect(() => {
    if (!owner.current || status?.state === 'connected' || status?.state === 'failed' || status?.state === 'cancelled') return
    let active = true
    let pending = false
    const timer = window.setInterval(async () => {
      if (!active || !owner.current || pending) return
      pending = true
      try {
        const latest = await api.browserLoginStatus(owner.current.id, owner.current.token)
        if (!active) return
        setStatus(latest)
        if (latest.state === 'connected') {
          sessionStorage.removeItem(STORAGE_KEY)
          sessionStorage.removeItem(REQUEST_KEY)
          setFrame(null)
          onConnected()
        } else if (latest.state === 'qr_ready' || latest.state === 'challenge_required') {
          const image = await api.browserLoginFrame(owner.current.id, owner.current.token)
          if (active) setFrame(image)
        } else if (active) setFrame(null)
      } catch (problem) {
        if (!active) return
        try {
          if ((await api.account()).status === 'connected') {
            sessionStorage.removeItem(STORAGE_KEY)
            sessionStorage.removeItem(REQUEST_KEY)
            setFrame(null)
            onConnected()
            return
          }
        } catch { /* Keep the original login error. */ }
        if (active) setError((problem as Error).message)
      }
      finally { pending = false }
    }, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [status?.state, onConnected])

  const close = () => {
    const task = owner.current
    sessionStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(REQUEST_KEY)
    if (task && status?.state !== 'connected') void api.cancelBrowserLogin(task.id, task.token).catch(() => undefined)
    onClose()
  }
  const refresh = async () => {
    if (!owner.current) return
    setFrame(null)
    setError('')
    try { setStatus(await api.refreshBrowserLogin(owner.current.id, owner.current.token)) }
    catch (problem) { setError((problem as Error).message) }
  }
  const send = (events: LoginEvent[]) => {
    const task = owner.current
    if (!task || !frame) return
    const frameId = frame.frame_id
    inputChain.current = inputChain.current.then(async () => {
      await api.browserLoginInput(task.id, task.token, frameId, events)
    }).catch((problem) => { if (live.current) setError((problem as Error).message) })
  }
  const point = (event: PointerEvent<HTMLImageElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1279, Math.round((event.clientX - box.left) * 1280 / box.width))),
      y: Math.max(0, Math.min(899, Math.round((event.clientY - box.top) * 900 / box.height))),
    }
  }
  const image = frame?.image_data_url
  const challenge = status?.state === 'challenge_required' && frame?.frame_mode === 'page'

  return <Dialog isOpen onOpenChange={open => { if (!open) close() }} purpose="form" width={challenge ? 'min(100%, 72rem)' : 'min(100%, 36rem)'} maxHeight="90dvh">
    <VStack gap={4}>
    <DialogHeader title="登录知乎" subtitle={status?.message || '正在准备登录页面'} onOpenChange={() => close()} />
    {busy && <div className="zhihu-login-wait">正在打开知乎登录页面…</div>}
    {error && <p className="zhihu-login-error">{error}</p>}
    {image && !challenge && <div className="zhihu-login-qr"><img src={image} alt="知乎登录二维码" /><span>请用知乎 App 扫码并在手机上确认</span></div>}
    {image && challenge && <div className="zhihu-login-screen"><div className={`zhihu-login-screen-view ${zoom ? 'zoomed' : ''}`}><img src={image} alt="知乎安全验证页面" draggable={false}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); send([{ type: 'down', ...point(event) }]) }}
      onPointerMove={(event) => { if (!(event.buttons & 1) || Date.now() - lastMove.current < 80) return; lastMove.current = Date.now(); send([{ type: 'move', ...point(event) }]) }}
      onPointerUp={(event) => send([{ type: 'up', ...point(event) }])}
      onPointerCancel={(event) => send([{ type: 'up', ...point(event) }])} /></div>
      <p>在画面中完成知乎验证或选择扫码登录。画面变化时稍等片刻再操作。<button type="button" className="zhihu-login-zoom" onClick={() => setZoom((value) => !value)}>{zoom ? '适应窗口' : '放大画面'}</button></p>
      <div className="zhihu-login-input"><TextInput label="验证输入" placeholder="点击画面中的输入框后，在这里输入验证码" value={verificationText} onChange={setVerificationText} autoComplete="one-time-code" />
        <Button label="输入" variant="secondary"  onClick={() => { send([{ type: 'text', value: verificationText }]); setVerificationText('') }}>输入</Button>
        <Button label="回车" variant="secondary"  onClick={() => send([{ type: 'key', key: 'Enter' }])}>回车</Button></div>
    </div>}
    {!image && !busy && !error && status?.state !== 'connected' && <div className="zhihu-login-wait">{status?.message || '正在加载知乎页面…'}</div>}
    <footer><Button label="关闭" variant="secondary"  onClick={close}>关闭</Button>{status?.can_refresh && <Button label="刷新登录页面" variant="primary"  onClick={() => void refresh()}>刷新登录页面</Button>}</footer>
  </VStack></Dialog>
}
