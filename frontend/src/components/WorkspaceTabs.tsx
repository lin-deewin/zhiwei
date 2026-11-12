import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Home, ArrowDownToLine, BookOpen, Clock3, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, FileText, LayoutGrid, Pin, RefreshCw, Settings2, Sparkles, Tags, X } from 'lucide-react'

const pages = {
  '/overview': { title: '概览', icon: Home },
  '/': { title: '资料库', icon: LayoutGrid },
  '/questions': { title: '话题汇总', icon: CircleHelp },
  '/categories': { title: '主题分类', icon: Tags },
  '/ask': { title: 'AI 助手', icon: Sparkles },
  '/knowledge': { title: '知识工作台', icon: BookOpen },
  '/personal-notes': { title: '个人笔记', icon: FileText },
  '/notes': { title: '阅读记录', icon: BookOpen },
  '/reading': { title: '最近阅读', icon: Clock3 },
  '/sync': { title: '同步中心', icon: ArrowDownToLine },
  '/settings': { title: '设置', icon: Settings2 },
}
type WorkspaceTab = { key: string; href: string; title?: string; revision?: number }
const ActiveContext = createContext(true)
export function useWorkspaceActive() {
  return useContext(ActiveContext)
}
const TitleContext = createContext<((title: string) => void) | null>(null)
export function useWorkspaceTitle(title?: string) {
  const update = useContext(TitleContext)
  useEffect(() => { if (title) update?.(title) }, [title, update])
}
function describe(key: string) {
  if (key.startsWith('/read/')) return { title: '文章阅读', icon: BookOpen }
  if (key.startsWith('/questions/')) return { title: '话题详情', icon: CircleHelp }
  return pages[key as keyof typeof pages] ?? pages['/']
}
function routeKey(path: string) {
  return path in pages || /^\/(read|questions)\/[^/]+$/.test(path) ? path : '/'
}
export function WorkspaceTabs({ children }: { children: (href: string) => ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const route = routeKey(location.pathname)
  const pendingSelection = useRef<{ tab: WorkspaceTab; fromLocationKey: string } | null>(null)
  if (pendingSelection.current && pendingSelection.current.fromLocationKey !== location.key) pendingSelection.current = null
  const activeKey = pendingSelection.current?.tab.key ?? route
  const href = pendingSelection.current?.tab.href ?? (location.pathname + location.search + location.hash)
  const [tabs, setTabs] = useState<WorkspaceTab[]>([{ key: '/', href: '/' }])
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const positions = useRef(new Map<string, number>())
  const previousKey = useRef(activeKey)
  const existing = tabs.find((tab) => tab.key === activeKey)
  const visibleTabs = existing ? tabs.map((tab) => tab.key === activeKey ? { ...tab, href } : tab) : [...tabs, { key: activeKey, href }]
  // Reconcile during render: direct links and browser history must not flash an empty panel.
  if (!existing || existing.href !== href) setTabs(visibleTabs)
  useLayoutEffect(() => {
    const reveal = () => buttons.current.get(activeKey)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    reveal()
    const observer = new ResizeObserver(reveal)
    if (strip.current) observer.observe(strip.current)
    if (previousKey.current !== activeKey) {
      window.scrollTo({ top: positions.current.get(activeKey) ?? 0, behavior: 'instant' })
      previousKey.current = activeKey
    }
    const remember = () => positions.current.set(activeKey, window.scrollY)
    window.addEventListener('scroll', remember, { passive: true })
    return () => { window.removeEventListener('scroll', remember); observer.disconnect() }
  }, [activeKey])
  useEffect(() => {
    if (!menuOpen) return
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menuOpen])
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const element = contextMenuRef.current
    const bounds = element.getBoundingClientRect()
    element.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - bounds.width - 8))}px`
    element.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - bounds.height - 8))}px`
    element.querySelector('button')?.focus({ preventScroll: true })
  }, [contextMenu])
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null)
    }
    const cancel = () => setContextMenu(null)
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancel()
      buttons.current.get(contextMenu.key)?.focus({ preventScroll: true })
    }
    const scroll = (event: Event) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) cancel()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [contextMenu])
  useEffect(() => { setContextMenu(null) }, [location.key])
  const refreshTab = (key: string) => {
    // Remount only this route tree; keep every other tab's state and URL intact.
    setTabs((current) => current.map((tab) => tab.key === key
      ? { ...tab, revision: (tab.revision ?? 0) + 1 } : tab))
    setContextMenu(null)
    buttons.current.get(key)?.focus({ preventScroll: true })
  }
  const select = (tab: WorkspaceTab, focus = false) => {
    positions.current.set(activeKey, window.scrollY)
    pendingSelection.current = { tab, fromLocationKey: location.key }
    navigate(tab.href)
    if (focus) buttons.current.get(tab.key)?.focus({ preventScroll: true })
  }
  const updateTitle = useCallback((key: string, title: string) => {
    setTabs((current) => current.some((item) => item.key === key && item.title !== title)
      ? current.map((item) => item.key === key ? { ...item, title } : item) : current)
  }, [])
  const close = (key: string) => {
    if (key === '/') return
    const index = visibleTabs.findIndex((tab) => tab.key === key)
    const remaining = visibleTabs.filter((tab) => tab.key !== key)
    if (key === activeKey) select(remaining[Math.min(index, remaining.length - 1)], true)
    setTabs(remaining)
    positions.current.delete(key)
  }
  const closeMany = (others: boolean) => {
    const remaining = visibleTabs.filter((tab) => tab.key === '/' || (others && tab.key === activeKey))
    if (!others && activeKey !== '/') select(remaining[0], true)
    setTabs(remaining)
    setMenuOpen(false)
    buttons.current.get(others ? activeKey : '/')?.focus({ preventScroll: true })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      setMenuOpen(false)
      setContextMenu({ key, x: bounds.left, y: bounds.bottom + 4 })
      return
    }
    const index = visibleTabs.findIndex((tab) => tab.key === key)
    let next: number | undefined
    if (event.key === 'ArrowRight') next = (index + 1) % visibleTabs.length
    if (event.key === 'ArrowLeft') next = (index - 1 + visibleTabs.length) % visibleTabs.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = visibleTabs.length - 1
    if (next !== undefined) { event.preventDefault(); select(visibleTabs[next], true) }
    if (event.key === 'Delete' && key !== '/') { event.preventDefault(); close(key) }
  }
  return <>
    <div className="workspace-tabbar">
      <button className="workspace-scroll" aria-label="向左滚动标签" onClick={() => strip.current?.scrollBy({ left: -240, behavior: 'smooth' })}><ChevronLeft size={15} /></button>
      <div className="workspace-tabstrip" ref={strip} role="tablist" aria-label="工作区页面">
        {visibleTabs.map((tab) => {
          const descriptor = describe(tab.key)
          const Icon = descriptor.icon
          const title = tab.title || descriptor.title
          const selected = tab.key === activeKey
          return <div key={tab.key} className={`workspace-tab${selected ? ' active' : ''}`} onContextMenu={(event) => { event.preventDefault(); setMenuOpen(false); setContextMenu({ key: tab.key, x: event.clientX, y: event.clientY }) }} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(tab.key) } }}>
            <button ref={(node) => { if (node) buttons.current.set(tab.key, node); else buttons.current.delete(tab.key) }} className="workspace-tab-select" role="tab" id={`workspace-tab-${encodeURIComponent(tab.key)}`} aria-controls={`workspace-panel-${encodeURIComponent(tab.key)}`} aria-selected={selected} tabIndex={selected ? 0 : -1} title={title} onClick={() => select(tab)} onKeyDown={(event) => onKeyDown(event, tab.key)}>
              <Icon size={15} /><span>{title}</span>{tab.key === '/' && <Pin size={11} className="workspace-pin" />}
            </button>
            {tab.key !== '/' && <button className="workspace-tab-close" aria-label={`关闭${title}标签`} title="关闭标签" tabIndex={selected ? 0 : -1} onClick={() => close(tab.key)}><X size={13} /></button>}
          </div>
        })}
      </div>
      <button className="workspace-scroll" aria-label="向右滚动标签" onClick={() => strip.current?.scrollBy({ left: 240, behavior: 'smooth' })}><ChevronRight size={15} /></button>
      <div className="workspace-tab-tools" ref={menu} onKeyDown={(event) => { if (event.key === 'Escape') { setMenuOpen(false); menu.current?.querySelector('button')?.focus() } }}>
        <button className="workspace-menu-trigger" aria-label="标签页操作" aria-expanded={menuOpen} onClick={() => { setContextMenu(null); setMenuOpen(!menuOpen) }} title="标签页操作"><span>{visibleTabs.length}</span><ChevronDown size={14} /></button>
        {menuOpen && <div className="workspace-tab-menu"><small>工作区标签</small><button disabled={visibleTabs.length <= (activeKey === '/' ? 1 : 2)} onClick={() => closeMany(true)}>关闭其他标签</button><button disabled={visibleTabs.length === 1} onClick={() => closeMany(false)}>关闭全部标签</button><p>← → 切换 · Delete 关闭<br />文章库固定保留</p></div>}
      </div>
    </div>
    {contextMenu && <div ref={contextMenuRef} className="workspace-context-menu" role="menu" aria-label="标签页右键菜单" style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); contextMenuRef.current?.querySelector('button')?.focus() }
      if (event.key === 'Tab') setContextMenu(null)
    }}>
      <button role="menuitem" onClick={() => refreshTab(contextMenu.key)}><RefreshCw size={13} /><span>刷新</span></button>
    </div>}
    {visibleTabs.map((tab) => <WorkspacePanel key={tab.key} tab={tab} active={tab.key === activeKey} onTitle={updateTitle}>{children(tab.href)}</WorkspacePanel>)}
  </>
}
function WorkspacePanel({ tab, active, onTitle, children }: { tab: WorkspaceTab; active: boolean; onTitle: (key: string, title: string) => void; children: ReactNode }) {
  const updateTitle = useCallback((title: string) => onTitle(tab.key, title), [onTitle, tab.key])
  const [visited, setVisited] = useState(active)
  if (active && !visited) setVisited(true)
  return <section className="workspace-panel" role="tabpanel" id={`workspace-panel-${encodeURIComponent(tab.key)}`} aria-labelledby={`workspace-tab-${encodeURIComponent(tab.key)}`} hidden={!active} inert={!active} tabIndex={0}>
    {(visited || active) && <ActiveContext.Provider value={active}><TitleContext.Provider value={updateTitle}><div key={tab.revision ?? 0} className="page-content">{children}</div></TitleContext.Provider></ActiveContext.Provider>}
  </section>
}
