import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowRight, BookOpen, Check, CircleHelp, FileText, Home, Network, Search, Settings2, Sparkles, Tags, X } from 'lucide-react'
import { api } from './api'
import type { Category, Content, LibrarySettings } from './types'
import type { Notice } from './app/types'
import { AppShell } from './app/AppShell'
import { AppRouter } from './app/router'

function App() {
  const [notice, setNotice] = useState<Notice>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [quickResults, setQuickResults] = useState<Content[]>([])
  const [dark, setDark] = useState(() => window.localStorage.getItem('zhiwei-theme') === 'dark')
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => window.localStorage.getItem('zhiwei-density') === 'compact' ? 'compact' : 'comfortable')
  const navigate = useNavigate()
  const location = useLocation()

  const reload = useCallback(() => setRefresh((value) => value + 1), [])
  useEffect(() => {
    api.categories().then(setCategories).catch((error) => setNotice({ message: error.message, error: true }))
    api.settings().then(setSettings).catch(() => undefined)
  }, [refresh])
  useEffect(() => {
    const controller = new AbortController()
    setPendingCount(null)
    api.contents('', undefined, 1, true, 1, 'synced', controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPendingCount(result.total) })
      .catch(() => { if (!controller.signal.aborted) setPendingCount(null) })
    return () => controller.abort()
  }, [refresh])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    document.body.classList.toggle('dark', dark)
    window.localStorage.setItem('zhiwei-theme', dark ? 'dark' : 'light')
    return () => { document.body.classList.remove('dark') }
  }, [dark])
  useEffect(() => {
    document.body.classList.toggle('compact', density === 'compact')
    window.localStorage.setItem('zhiwei-density', density)
    return () => { document.body.classList.remove('compact') }
  }, [density])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
      if (event.key === 'Escape') { setCommandOpen(false); setMobileOpen(false) }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!commandOpen || !commandQuery.trim()) { setQuickResults([]); return }
    let active = true
    const timer = window.setTimeout(() => {
      api.contents(commandQuery.trim(), undefined, 1, false, 5, 'synced')
        .then((result) => { if (active) setQuickResults(result.items) })
        .catch(() => { if (active) setQuickResults([]) })
    }, 200)
    return () => { active = false; window.clearTimeout(timer) }
  }, [commandOpen, commandQuery])

  const importFile = async (file?: File) => {
    if (!file) return
    try {
      const item = await api.importMarkdown(file)
      setNotice({ message: '已导入「' + item.title + '」' })
      reload()
      navigate('/read/' + encodeURIComponent(item.id))
    } catch (error) {
      setNotice({ message: (error as Error).message, error: true })
    }
  }
  const sync = async (mode: 'full' | 'incremental', folderIds: string[]) => {
    try {
      await api.startSync(mode, folderIds)
      setNotice({ message: '同步任务已启动，进度会在同步中心更新。' })
    } catch (error) {
      setNotice({ message: (error as Error).message, error: true })
    }
  }
  const navigateTo = (path: string) => {
    navigate(path)
    setCommandOpen(false)
    setMobileOpen(false)
  }
  const navGroups = [
    { heading: '我的工作台', items: [
      { href: '/', title: '概览', icon: Home },
      { href: '/library', title: '文章库', icon: BookOpen },
      { href: '/questions', title: '话题汇总', icon: CircleHelp },
      { href: '/notes', title: '我的笔记', icon: FileText },
    ] },
    { heading: '知识探索', items: [
      { href: '/categories', title: '主题目录', icon: Tags },
      { href: '/knowledge', title: '知识空间', icon: Network },
      { href: '/ask', title: 'AI 研究', icon: Sparkles },
    ] },
    { heading: '工具与偏好', items: [
      { href: '/sync', title: '同步中心', icon: ArrowDownToLine },
      { href: '/settings', title: '偏好设置', icon: Settings2 },
    ] },
  ]
  const pageTitles: Record<string, string> = {
    '/': '概览', '/library': '文章库', '/questions': '话题汇总',
    '/notes': '我的笔记', '/categories': '主题目录', '/knowledge': '知识空间',
    '/ask': 'AI 研究', '/sync': '同步中心', '/settings': '偏好设置',
  }
  const pageTitle = location.pathname.startsWith('/read/') ? '阅读文章'
    : location.pathname.startsWith('/questions/') ? '话题详情'
    : pageTitles[location.pathname] || '我的知识空间'
  return <AppShell
    navGroups={navGroups}
    pageTitle={pageTitle}
    contentCount={settings?.content_count ?? '—'}
    libraryPath={settings?.library_dir ? shortenPath(settings.library_dir) : '本地优先 · 个人资料库'}
    isReady={Boolean(settings)}
    mobileOpen={mobileOpen}
    onMobileOpenChange={setMobileOpen}
    onOpenSearch={() => { setCommandOpen(true); setCommandQuery('') }}
    dark={dark}
    onToggleTheme={() => setDark((value) => !value)}
  >
    <AppRouter
      categories={categories}
      settings={settings}
      pendingCount={pendingCount}
      refresh={refresh}
      search={search}
      onSearchChange={setSearch}
      onImport={importFile}
      onNotice={setNotice}
      onLibraryChanged={reload}
      onSync={sync}
      onSettingsSaved={(value) => { setSettings(value); reload(); setNotice({ message: '资料目录已更新' }) }}
      dark={dark}
      density={density}
      onThemeChange={setDark}
      onDensityChange={setDensity}
    />

    {commandOpen && <div className="zv-command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false) }}>
      <div className="zv-command" role="dialog" aria-modal="true" aria-label="快速搜索">
        <div className="zv-command-search"><Search size={20} /><input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="搜索页面、文章或功能..." /></div>
        <div className="zv-command-results">
          <div className="zv-command-heading">快速导航</div>
          {navGroups.flatMap((group) => group.items).filter((item) => !commandQuery || item.title.includes(commandQuery)).map((item) => {
            const Icon = item.icon
            return <button key={item.href} onClick={() => navigateTo(item.href)}><Icon size={16} /><span>{item.title}</span><ArrowRight size={14} /></button>
          })}
          {quickResults.length > 0 && <div className="zv-command-heading">文章</div>}
          {quickResults.map((item) => <button key={item.id} onClick={() => navigateTo('/read/' + encodeURIComponent(item.id))}><BookOpen size={16} /><span>{item.title}</span><ArrowRight size={14} /></button>)}
        </div><div className="zv-command-footer">点击打开 · Esc 关闭 · ⌘ K 快速检索</div>
      </div>
    </div>}
    {notice && <div className={'zv-toast' + (notice.error ? ' zv-error' : '')} role="status"><Check size={16} /><span>{notice.message}</span><button aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
  </AppShell>
}

function shortenPath(path: string) {
  const home = path.replace(/^\/home\/[^/]+/, '~')
  return home.length > 28 ? `…${home.slice(-26)}` : home
}

export default App
