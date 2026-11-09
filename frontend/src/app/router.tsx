import { Route, Routes, useNavigate } from 'react-router-dom'
import { WorkspaceTabs } from '../components/WorkspaceTabs'
import { KnowledgeHub } from '../components/KnowledgeHub'
import { KnowledgePage } from '../components/KnowledgePage'
import { NotesPage } from '../components/ReaderWorkspace'
import { OverviewPage } from '../components/OverviewPage'
import { LibraryPage } from '../features/library/LibraryPage'
import { ReaderPage } from '../features/reader/ReaderPage'
import { SyncPage } from '../features/sync/SyncPage'
import { QuestionsPage } from '../features/questions/QuestionsPage'
import { QuestionDetail } from '../features/questions/QuestionDetail'
import { CategoriesPage } from '../features/categories/CategoriesPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import type { Category, LibrarySettings } from '../types'
import type { Notice } from './types'

type AppRouterProps = {
  categories: Category[]
  settings: LibrarySettings | null
  pendingCount: number | null
  refresh: number
  search: string
  onSearchChange: (value: string) => void
  onImport: (file?: File) => void
  onNotice: (notice: Notice) => void
  onLibraryChanged: () => void
  onSync: (mode: 'full' | 'incremental', folderIds: string[]) => Promise<void>
  onSettingsSaved: (settings: LibrarySettings) => void
  dark: boolean
  density: 'comfortable' | 'compact'
  onThemeChange: (dark: boolean) => void
  onDensityChange: (density: 'comfortable' | 'compact') => void
}

export function AppRouter({
  categories,
  settings,
  pendingCount,
  refresh,
  search,
  onSearchChange,
  onImport,
  onNotice,
  onLibraryChanged,
  onSync,
  onSettingsSaved,
  dark,
  density,
  onThemeChange,
  onDensityChange,
}: AppRouterProps) {
  const navigate = useNavigate()
  return <WorkspaceTabs>{(href) => <Routes location={href}>
    <Route path="/" element={<OverviewPage categories={categories} settings={settings} pendingCount={pendingCount} refresh={refresh} />} />
    <Route path="/library" element={<LibraryPage search={search} categories={categories} refresh={refresh} onSearchChange={onSearchChange} onImport={onImport} onNotice={onNotice} onLibraryChanged={onLibraryChanged} />} />
    <Route path="/read/:id" element={<ReaderPage categories={categories} onNotice={onNotice} reload={onLibraryChanged} />} />
    <Route path="/sync" element={<SyncPage onSync={onSync} onImport={onImport} onNotice={onNotice} onLibraryChanged={onLibraryChanged} />} />
    <Route path="/questions" element={<QuestionsPage categories={categories} onNotice={onNotice} />} />
    <Route path="/questions/:id" element={<QuestionDetail categories={categories} onNotice={onNotice} />} />
    <Route path="/categories" element={<CategoriesPage categories={categories} refresh={onLibraryChanged} onNotice={onNotice} onCategoryOpen={() => onSearchChange('')} />} />
    <Route path="/settings" element={<SettingsPage settings={settings} onSaved={onSettingsSaved} onNotice={onNotice} onConnect={async () => { navigate('/sync') }} dark={dark} density={density} onThemeChange={onThemeChange} onDensityChange={onDensityChange} />} />
    <Route path="/ask" element={<KnowledgePage categories={categories} />} />
    <Route path="/knowledge" element={<KnowledgeHub onNotice={onNotice} />} />
    <Route path="/notes" element={<NotesPage onNotice={(message, error) => onNotice({ message, error })} />} />
    <Route path="*" element={<OverviewPage categories={categories} settings={settings} pendingCount={pendingCount} refresh={refresh} />} />
  </Routes>}</WorkspaceTabs>
}
