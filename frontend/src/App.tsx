import { useCallback, useEffect, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { Check, CircleHelp, X } from 'lucide-react'
import { api } from './api'
import type { Category, LibrarySettings } from './types'
import type { Notice } from './types/ui'
import { NotesPage } from './components/ReaderWorkspace'
import { KnowledgePage } from './components/KnowledgePage'
import { WorkspaceTabs } from './components/WorkspaceTabs'
import { KnowledgeHub } from './components/KnowledgeHub'
import { EmptyLibrary, LibraryPage } from './components/LibraryPage'
import { AppSidebar } from './components/AppSidebar'
import { ReaderPage } from './components/ReaderPage'
import { QuestionsPage, QuestionDetail } from './components/QuestionsPages'
import { SyncPage } from './components/SyncPage'
import { CategoriesPage } from './components/CategoriesPage'
import { SettingsPage } from './components/SettingsPage'

function App() {
  const [notice, setNotice] = useState<Notice>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const navigate = useNavigate()

  const reload = useCallback(() => setRefresh((value) => value + 1), [])
  useEffect(() => {
    api.categories().then(setCategories).catch((e) => setNotice({ message: e.message, error: true }))
    api.settings().then(setSettings).catch(() => undefined)
  }, [refresh])
  useEffect(() => {
    const controller = new AbortController()
    setPendingCount(null)
    // Match the pending article list exactly, including manually locked unclassified articles.
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

  const importFile = async (file?: File) => {
    if (!file) return
    try {
      const item = await api.importMarkdown(file)
      setNotice({ message: `已导入「${item.title}」` })
      reload()
      navigate(`/read/${encodeURIComponent(item.id)}`)
    } catch (e) {
      setNotice({ message: (e as Error).message, error: true })
    }
  }

  const sync = async (mode: 'full' | 'incremental', folderIds: string[]) => {
    try {
      await api.startSync(mode, folderIds)
      setNotice({ message: '同步任务已启动，进度会在同步中心更新。' })
    } catch (e) {
      setNotice({ message: (e as Error).message, error: true })
    }
  }

  const connectZhihu = async () => {
    navigate('/sync')
  }

  return <div className="app-shell">
    <AppSidebar categories={categories} settings={settings} pendingCount={pendingCount} />
    <main className="main-area">
      <WorkspaceTabs>{(href) => <Routes location={href}>
          <Route path="/" element={<LibraryPage search={search} categories={categories} refresh={refresh} onSearchChange={setSearch} onImport={importFile} onNotice={setNotice} onLibraryChanged={reload} />} />
          <Route path="/read/:id" element={<ReaderPage categories={categories} onNotice={setNotice} reload={reload} />} />
          <Route path="/sync" element={<SyncPage onSync={sync} onImport={importFile} onNotice={setNotice} onLibraryChanged={reload} />} />
          <Route path="/questions" element={<QuestionsPage categories={categories} onNotice={setNotice} />} />
          <Route path="/questions/:id" element={<QuestionDetail categories={categories} onNotice={setNotice} />} />
          <Route path="/categories" element={<CategoriesPage categories={categories} refresh={reload} onNotice={setNotice} onCategoryOpen={() => setSearch('')} />} />
          <Route path="/settings" element={<SettingsPage settings={settings} onSaved={(s) => { setSettings(s); reload(); setNotice({ message: '资料目录已更新' }) }} onNotice={setNotice} onConnect={connectZhihu} />} />
          <Route path="/ask" element={<KnowledgePage categories={categories} />} />
          <Route path="/knowledge" element={<KnowledgeHub onNotice={setNotice} />} />
          <Route path="/notes" element={<NotesPage onNotice={(message, error) => setNotice({ message, error })} />} />
          <Route path="*" element={<LibraryPage search="" categories={categories} refresh={refresh} onSearchChange={setSearch} onImport={importFile} onNotice={setNotice} onLibraryChanged={reload} />} />
        </Routes>}</WorkspaceTabs>
    </main>
    {notice && <div className={notice.error ? 'toast toast-error' : 'toast'}><span>{notice.error ? <CircleHelp size={17} /> : <Check size={17} />}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="关闭"><X size={15} /></button></div>}
  </div>
}






export default App

