import {PageState} from './components/shared/PageState'
import {AppShell} from '@astryxdesign/core/AppShell'
import {AppProviders} from './theme/AppProviders'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import {NoticeFeedback} from './components/shared/NoticeFeedback'
import { api } from './api'
import type { Category, LibrarySettings } from './types'
import type { Notice } from './types/ui'
const NotesPage = lazy(() => import('./components/NotesPage').then(module => ({default: module.NotesPage})))
const PersonalNotesPage = lazy(() => import('./components/PersonalNotesPage').then(module => ({default: module.PersonalNotesPage})))
const KnowledgePage = lazy(() => import('./components/KnowledgePage').then(module => ({default: module.KnowledgePage})))
import { WorkspaceTabs } from './components/WorkspaceTabs'
const KnowledgeHub = lazy(() => import('./components/KnowledgeHub').then(module => ({default: module.KnowledgeHub})))
import { LibraryPage } from './components/LibraryPage'
import { AppSidebar } from './components/AppSidebar'
const ReaderPage = lazy(() => import('./components/ReaderPage').then(module => ({default: module.ReaderPage})))
const ReadingHubPage = lazy(() => import('./components/ReadingHubPage').then(module => ({default: module.ReadingHubPage})))
const QuestionsPage = lazy(() => import('./components/QuestionsPages').then(module => ({default: module.QuestionsPage})))
const QuestionDetail = lazy(() => import('./components/QuestionsPages').then(module => ({default: module.QuestionDetail})))
const SyncPage = lazy(() => import('./components/SyncPage').then(module => ({default: module.SyncPage})))
const CategoriesPage = lazy(() => import('./components/CategoriesPage').then(module => ({default: module.CategoriesPage})))
const OverviewPage = lazy(() => import('./components/OverviewPage').then(module => ({default: module.OverviewPage})))
const SettingsPage = lazy(() => import('./components/SettingsPage').then(module => ({default: module.SettingsPage})))

function App() {
  const [readingTheme, setReadingTheme] = useState(() => {
    try { return localStorage.getItem('zhiwei-reading-theme') === 'warm' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('zhiwei-reading-theme', readingTheme ? 'warm' : 'light') } catch { /* Storage can be disabled. */ }
  }, [readingTheme])
  const [notice, setNotice] = useState<Notice>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const navigate = useNavigate()

  const notesNotice = useCallback((message: string, error?: boolean) => setNotice({message, error}), [])
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

  return <AppProviders dark={readingTheme}><AppShell height="auto" variant="surface" contentPadding={0} sideNav={<AppSidebar readingTheme={readingTheme} onThemeToggle={() => setReadingTheme(value => !value)} categories={categories} settings={settings} pendingCount={pendingCount} />} >
      <WorkspaceTabs>{(href) => <Suspense fallback={<PageState loading />}><Routes location={href}>
          <Route path="/overview" element={<OverviewPage categories={categories} settings={settings} pendingCount={pendingCount} refresh={refresh} />} />
          <Route path="/" element={<LibraryPage search={search} categories={categories} refresh={refresh} onSearchChange={setSearch} onImport={importFile} onNotice={setNotice} onLibraryChanged={reload} />} />
          <Route path="/read/:id" element={<ReaderPage categories={categories} onNotice={setNotice} reload={reload} />} />
          <Route path="/reading" element={<ReadingHubPage onNotice={setNotice} />} />
          <Route path="/sync" element={<SyncPage onSync={sync} onImport={importFile} onNotice={setNotice} onLibraryChanged={reload} />} />
          <Route path="/questions" element={<QuestionsPage categories={categories} onNotice={setNotice} />} />
          <Route path="/questions/:id" element={<QuestionDetail categories={categories} onNotice={setNotice} />} />
          <Route path="/categories" element={<CategoriesPage categories={categories} refresh={reload} onNotice={setNotice} onCategoryOpen={() => setSearch('')} />} />
          <Route path="/settings" element={<SettingsPage settings={settings} onSaved={(s) => { setSettings(s); reload(); setNotice({ message: '资料目录已更新' }) }} onNotice={setNotice} onConnect={connectZhihu} />} />
          <Route path="/ask" element={<KnowledgePage categories={categories} />} />
          <Route path="/knowledge" element={<KnowledgeHub categories={categories} onNotice={setNotice} />} />
          <Route path="/personal-notes" element={<PersonalNotesPage onNotice={setNotice} />} />
          <Route path="/notes" element={<NotesPage onNotice={notesNotice} />} />
          <Route path="*" element={<LibraryPage search="" categories={categories} refresh={refresh} onSearchChange={setSearch} onImport={importFile} onNotice={setNotice} onLibraryChanged={reload} />} />
        </Routes></Suspense>}</WorkspaceTabs>

    <NoticeFeedback notice={notice} onDismiss={() => setNotice(null)} />
  </AppShell></AppProviders>
}






export default App

