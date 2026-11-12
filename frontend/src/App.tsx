import { useWikiLinks, wikiPlugin } from './utils/wiki_markdown'
import { Children, createElement, isValidElement, memo, useCallback, useEffect, useRef, useState, type ReactNode, type HTMLAttributes, type ElementType } from 'react'
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Bookmark, Bot, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, FileText, FolderOpen, Hash,
  LayoutGrid, LoaderCircle, MoreHorizontal, Plus, Search, Settings2, Tags,
  Trash2, Upload, X,
} from 'lucide-react'
import { api } from './api'
import type { AccountStatus } from './api'
import type { Category, ClassificationJob, Content, LibrarySettings, SyncJob, ZhihuFolder, Question, QuestionJob } from './types'
import type { ReadingBlock, ReadingContext } from './types'
import { ZhihuLoginDialog } from './components/ZhihuLoginDialog'
import { Pagination } from './components/Pagination'
import { DeleteArticleDialog } from './components/DeleteArticleDialog'
import { NotesPage, ReaderWorkspace } from './components/ReaderWorkspace'
import { KnowledgePage } from './components/KnowledgePage'
import { WorkspaceTabs, useWorkspaceTitle } from './components/WorkspaceTabs'
import { KnowledgeHub } from './components/KnowledgeHub'
import { AppSidebar } from './components/AppSidebar'

type Notice = { message: string; error?: boolean } | null

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


function LibraryPage({ search, categories, refresh, onSearchChange, onImport, onNotice, onLibraryChanged }: {
  search: string; categories: Category[]; refresh: number; onSearchChange: (search: string) => void; onImport: (file?: File) => void;
  onNotice: (notice: Notice) => void; onLibraryChanged: () => void
}) {
  const [items, setItems] = useState<Content[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState<number | undefined>()
  const [categoryFromUrl, setCategoryFromUrl] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [source, setSource] = useState('all')
  const [sort, setSort] = useState('synced')
  const [pageSize, setPageSize] = useState(24)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Content | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const pendingOnly = params.get('pending') === '1'

  useEffect(() => {
    const next = Number(new URLSearchParams(location.search).get('category'))
    setCategory(next || undefined)
    setCategoryFromUrl(Boolean(next))
  }, [location.search])
  useEffect(() => {
    setLoading(true)
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api.contents(search, pendingOnly ? undefined : category, page, pendingOnly, pageSize, sort, controller.signal, source).then((data) => {
        if (active) { setItems(data.items); setTotal(data.total) }
      }).catch((e) => { if (active) onNotice({ message: e.message, error: true }) }).finally(() => { if (active) setLoading(false) })
    }, search ? 250 : 0)
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [search, category, pendingOnly, page, pageSize, sort, source, refresh])
  useEffect(() => { setPage(1) }, [search, category, pendingOnly, sort, pageSize, source])

  const currentCategory = categories.find((item) => item.id === category)
  const title = search ? '搜索结果' : pendingOnly ? '待整理' : currentCategory?.name || '全部文章'
  const removeArticle = async (item: Content) => {
    if (deletingId) return
    setDeleteError('')
    setDeletingId(item.id)
    try {
      await api.deleteContent(item.id)
      setItems((current) => current.filter((content) => content.id !== item.id))
      setTotal((current) => Math.max(0, current - 1))
      setDeleteTarget(null)
      onLibraryChanged()
      onNotice({ message: '文章已从本地删除，以后同步将跳过这篇文章。' })
    } catch (error) {
      setDeleteError((error as Error).message)
    } finally {
      setDeletingId(null)
    }
  }
  const visibleItems = items

  return <div className="library-page">
    {deleteTarget && <DeleteArticleDialog title={deleteTarget.title} busy={deletingId !== null} error={deleteError} onCancel={() => setDeleteTarget(null)} onConfirm={() => { void removeArticle(deleteTarget) }} />}
    <input id="md-upload" className="visually-hidden" type="file" accept=".md,.markdown,.txt" onChange={(e) => { onImport(e.target.files?.[0]); e.currentTarget.value = '' }} />
    <div className="library-search-row">
      <label className="library-source-filter"><span>来源</span><select aria-label="文章来源" value={source} onChange={(event) => { setSource(event.target.value); setPage(1) }}><option value="all">全部来源</option><option value="answer">知乎问答</option><option value="article">知乎文章</option><option value="local">本地导入</option></select></label>
    <label className="library-search"><Search size={18} /><input aria-label="搜索文章库" placeholder="搜索文章标题或正文…" value={search} onChange={(event) => { onSearchChange(event.target.value); setPage(1) }} />{search && <button aria-label="清空文章搜索" onClick={() => onSearchChange('')}><X size={16} /></button>}</label>
    </div>
    <div className="library-toolbar"><div className="section-heading"><div><h2>{title}</h2><p>{search ? `包含「${search}」的文章` : '你的私人阅读收藏'}</p></div><span className="article-total"><strong>{total}</strong> 篇</span></div>
      <div className="toolbar-controls"><label className="select-wrap"><span>排序</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="synced">最后同步时间</option><option value="title">标题 A–Z</option></select><ChevronDown size={14} /></label><span className="control-divider" /><div className="view-toggle"><button aria-label="卡片视图" className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}><LayoutGrid size={16} /></button><button aria-label="列表视图" className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><FileText size={16} /></button></div></div>
    </div>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" /> 正在打开你的资料库…</div> : visibleItems.length === 0 ? <EmptyLibrary searched={Boolean(search)} onImport={() => document.getElementById('md-upload')?.click()} /> : <div className={view === 'grid' ? 'article-grid' : 'article-list'}>
      {visibleItems.map((item, index) => <ArticleCard key={item.id} item={item} index={index} view={view} onDelete={(content) => { setDeleteError(''); setDeleteTarget(content) }} deleting={deletingId === item.id} deleteDisabled={deletingId !== null} />)}
    </div>}
    <Pagination page={page} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
    {(categoryFromUrl || pendingOnly) && <button className="filter-reset" onClick={() => navigate('/')}>清除主题筛选</button>}
  </div>
}

const cardTones = ['tone-apricot', 'tone-sage', 'tone-lilac', 'tone-blue']

function ArticleCard({ item, index, view, onDelete, deleting, deleteDisabled }: { item: Content; index: number; view: 'grid' | 'list'; onDelete: (item: Content) => void; deleting: boolean; deleteDisabled: boolean }) {
  return <div className="article-card-container"><Link to={`/read/${encodeURIComponent(item.id)}`} className={`article-card ${cardTones[index % cardTones.length]} ${view === 'list' ? 'as-list' : ''}`}>
    <div className="article-card-body"><div className="article-card-meta"><span className="type-label"><BookOpen size={12} /> {item.kind === 'answer' ? '知乎回答' : item.id.startsWith('local_') ? '本地导入' : '知乎文章'}</span><span className="date-label">{formatDate(item.last_synced_at || item.updated_at)}</span></div><h3>{item.title}</h3><p>{item.excerpt || '打开文章，开始阅读。'}</p><div className="article-card-footer"><span className="topic-pill"><Hash size={12} /><span>{item.category_name ? [item.category_parent_name, item.category_name].filter(Boolean).join(' / ') : '待整理'}</span></span><span className="read-link">继续阅读 <ArrowRight size={13} /></span></div></div>
  </Link><button className="article-delete-button" type="button" aria-label={`删除文章：${item.title}`} title="删除本地文章" disabled={deleteDisabled} onClick={() => onDelete(item)}>{deleting ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}</button></div>
}

function EmptyLibrary({ searched, onImport }: { searched: boolean; onImport: () => void }) {
  return <div className="empty-state"><div className="empty-illustration"><div className="empty-sun" /><div className="empty-page"><span /><span /><span /></div><div className="empty-spark">✦</div></div><h3>{searched ? '没有找到相关文章' : '这里还空着，导入第一篇文章吧'}</h3><p>{searched ? '试试其他关键词，或清除筛选条件。' : '支持 Markdown 文件。导入后可以在这里阅读和整理。'}</p>{!searched && <button className="button button-primary" onClick={onImport}><Upload size={16} /> 选择 Markdown 文件</button>}</div>
}

function markdownText(value: ReactNode): string {
  return Children.toArray(value).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (isValidElement<{ children?: ReactNode }>(child)) return markdownText(child.props.children)
    return ''
  }).join('')
}

const ArticleMarkdown = memo(function ArticleMarkdown({ contentId, markdown, blocks }: { contentId: string; markdown: string; blocks: ReadingBlock[] }) {
  let searchFrom = 0
  const matchedNodes = new Map<unknown, ReadingBlock>()
  const renderBlock = (Tag: ElementType) => (props: HTMLAttributes<HTMLElement> & { node?: unknown }) => {
    const text = markdownText(props.children).replace(/\s+/g, ' ').trim()
    const normalized = text.replace(/\s/g, '')
    // React may render the same Markdown node twice in development StrictMode.
    // Reuse its match instead of advancing past the original reading block.
    let found = props.node ? matchedNodes.get(props.node) : undefined
    for (let index = searchFrom; !found && index < blocks.length; index += 1) {
      const candidate = blocks[index]
      if (candidate.markable && candidate.text.replace(/\s/g, '') === normalized) {
        found = candidate
        if (props.node) matchedNodes.set(props.node, candidate)
        searchFrom = index + 1
        break
      }
    }
    const rest = { ...props }
    const children = rest.children
    delete rest.children
    delete rest.node
    return createElement(Tag, { ...rest, 'data-reading-block-id': found?.id, className: `${rest.className || ''} ${found ? 'reader-markable' : ''}` } as never, children)
  }
  const imageRenderer = ({ src = '', alt = '' }: { src?: string; alt?: string }) => {
    const localName = src.startsWith('assets/') ? src.split('/').pop() : ''
    const resolved = localName ? `/api/v1/contents/${encodeURIComponent(contentId)}/assets/${encodeURIComponent(localName)}` : src
    return <img src={resolved} alt={alt} loading="lazy" />
  }
  const links = useWikiLinks(markdown)
  return <ReactMarkdown remarkPlugins={[remarkGfm, [wikiPlugin, { links }]]} rehypePlugins={[rehypeSanitize, [rehypeHighlight, { detect: true, plainText: ['text', 'txt', 'plaintext'] }]]} components={{
    img: imageRenderer, p: renderBlock('p'), h1: renderBlock('h1'), h2: renderBlock('h2'),
    h3: renderBlock('h3'), h4: renderBlock('h4'), h5: renderBlock('h5'), h6: renderBlock('h6'),
    li: renderBlock('li'),
  }}>{markdown}</ReactMarkdown>
})

function ReaderPage({ categories, onNotice, reload }: { categories: Category[]; onNotice: (notice: Notice) => void; reload: () => void }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState<Content | null>(null)
  useWorkspaceTitle(item?.title)
  const [reading, setReading] = useState<ReadingContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [infoVisible, setInfoVisible] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.content(id), api.readingContext(id)]).then(([content, context]) => {
      if (!active) return
      setItem({ ...content, markdown: context.markdown, file_missing: context.file_missing })
      setReading(context)
      setLoading(false)
    }).catch((error) => {
      if (active) onNotice({ message: (error as Error).message, error: true })
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])
  if (loading) return <div className="loading-state"><LoaderCircle className="spin" /> 正在打开文章…</div>
  if (!item) return <EmptyLibrary searched onImport={() => navigate('/')} />
  const removeArticle = async () => {
    if (deleting) return
    setDeleteError('')
    setDeleting(true)
    try {
      await api.deleteContent(item.id)
      reload()
      navigate('/', { replace: true })
      onNotice({ message: '文章已从本地删除，以后同步将跳过这篇文章。' })
    } catch (error) {
      setDeleteError((error as Error).message)
      setDeleting(false)
    }
  }
  return <article className="reader-page">
    {deleteDialogOpen && <DeleteArticleDialog title={item.title} busy={deleting} error={deleteError} onCancel={() => setDeleteDialogOpen(false)} onConfirm={() => { void removeArticle() }} />}
    <div className="reader-toolbar">
      <button className="back-link" onClick={() => navigate(-1)}><ArrowLeft size={15} /> 返回文章库</button>
      <div className="reader-toolbar-actions">
      <button className="button button-soft reader-info-toggle" aria-expanded={infoVisible} aria-controls="reader-article-info" onClick={() => setInfoVisible((visible) => !visible)}>
        <Bookmark size={14} />{infoVisible ? '收起文章信息' : '展开文章信息'}<ChevronDown size={14} className={infoVisible ? 'is-expanded' : ''} />
      </button>
      <button className="button reader-delete-button" type="button" disabled={deleting} onClick={() => { setDeleteError(''); setDeleteDialogOpen(true) }}>
        {deleting ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}{deleting ? '删除中…' : '删除文章'}
      </button>
      </div>
    </div>
    <div className={`reader-layout${infoVisible ? '' : ' reader-info-collapsed'}`}><div className="reader-main"><div className="reader-kicker"><span className="reader-kicker-dot" /> {item.kind === 'answer' ? '知乎回答' : '收藏文章'} <span className="reader-kicker-sep">·</span> {formatDate(item.updated_at)}</div><h1>{item.title}</h1><div className="reader-byline"><span className="reader-author-avatar" aria-hidden="true">{(item.author || '佚').slice(0, 1)}</span><span className="reader-author">{item.author || '作者信息未知'}</span><span className="reader-byline-dot" /><span>离线阅读</span>{item.markdown && <span className="reader-duration"><Clock3 size={13} />约 {Math.max(1, Math.ceil(item.markdown.replace(/\s/g, '').length / 400))} 分钟</span>}</div>
      <div className="reader-rule" />{item.file_missing ? <div className="inline-warning">正文文件暂时不可用，请检查本地资料目录。</div> : <div className="markdown-body"><ArticleMarkdown contentId={item.id} markdown={item.markdown || ''} blocks={reading?.blocks || []} /></div>}
      {reading && <ReaderWorkspace context={reading} setContext={(next) => setReading((current) => typeof next === 'function' ? current ? next(current) : current : next)} onNotice={(message, error) => onNotice({ message, error })} />}
      {item.url && <a className="original-link" href={item.url} target="_blank" rel="noreferrer">在知乎打开原文 <ArrowRight size={14} /></a>}
    </div><aside id="reader-article-info" className="reader-aside" hidden={!infoVisible}><div className="aside-card"><div className="aside-card-heading"><Bookmark size={15} /><span>文章信息</span></div><div className="aside-field"><small>本地分类</small><div><select className="reader-category-select" value={item.category_id ?? ''} onChange={async (e) => { try { const updated = await api.classify(item.id, e.target.value ? Number(e.target.value) : null); setItem(updated); reload() } catch (err) { onNotice({ message: (err as Error).message, error: true }) } }}><option value="">待整理</option>{categories.filter((category) => category.parent_id || !categories.some((child) => child.parent_id === category.id)).map((category) => <option key={category.id} value={category.id}>{category.parent_id ? `${categories.find((parent) => parent.id === category.parent_id)?.name || ''} / ` : ''}{category.name}</option>)}</select>{item.category_id && <Link className="category-view-link" to={`/?category=${item.category_id}`}>查看该主题文章 <ArrowRight size={12} /></Link>}<button className="classify-ai" disabled={Boolean(item.classification_locked)} onClick={async () => { try { const result = await api.autoClassify(item.id); setItem(result.content); onNotice({ message: `分类建议：${result.reason}` }); reload() } catch (error) { onNotice({ message: (error as Error).message, error: true }) } }}>{item.classification_locked ? '已手动确认' : '✦ 智能分类'}</button>{item.classification_reason && <small className="classification-reason">{item.classification_reason}</small>}</div></div><div className="aside-field"><small>收藏夹来源</small>{item.folders?.length ? item.folders.map((folder) => /^https:\/\/www\.zhihu\.com\/collection\/\d+$/.test(folder.url || '') ? <a className="source-chip source-link" key={folder.id} href={folder.url!} target="_blank" rel="noopener noreferrer" title="在知乎打开收藏夹"><FolderOpen size={13} />{folder.name}<ArrowRight size={12} /></a> : <span className="source-chip" key={folder.id}><FolderOpen size={13} />{folder.name}</span>) : <span className="muted-text">本地导入 / 暂无记录</span>}</div><div className="aside-field"><small>本地文章 ID</small><code>{item.id}</code></div><div className="aside-field"><small>关联问题</small>{item.question && /^https:\/\/www\.zhihu\.com\/question\/\d+$/.test(item.question.url) ? <a className="source-chip source-link" href={item.question.url} target="_blank" rel="noopener noreferrer" title="在知乎打开问题"><CircleHelp size={13} />{item.question.title}<ArrowRight size={12} /></a> : <span className="muted-text">暂无问题信息</span>}</div></div><div className="offline-note"><span><Check size={15} /></span><div><strong>保存在你的设备</strong><p>正文文件位于本地资料目录，可离线阅读。</p></div></div></aside></div>
  </article>
}

function SyncPage({ onSync, onImport, onNotice, onLibraryChanged }: { onSync: (mode: 'full' | 'incremental', folderIds: string[]) => Promise<void>; onImport: (file?: File) => void; onNotice: (notice: Notice) => void; onLibraryChanged: () => void }) {
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental')
  const [jobs, setJobs] = useState<SyncJob[]>([])
  const [classificationJobs, setClassificationJobs] = useState<ClassificationJob[]>([])
  const [classificationPending, setClassificationPending] = useState<number | null>(null)
  const [folders, setFolders] = useState<ZhihuFolder[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[] | null>(null)
  const completedJobRef = useRef('')
  const completedClassificationRef = useRef('')
  const [account, setAccount] = useState<AccountStatus>({ status: 'not_connected', message: '' })
  const [loginOpen, setLoginOpen] = useState(false)
  const refreshAccount = () => api.account().then(setAccount).catch(() => undefined)
  useEffect(() => {
    api.account().then(setAccount).catch(() => undefined)
    const timer = window.setInterval(() => api.account().then(setAccount).catch(() => undefined), 5000)
    return () => window.clearInterval(timer)
  }, [])
  const onLoginConnected = useCallback(() => {
    setLoginOpen(false)
    api.account().then(setAccount).catch(() => undefined)
  }, [])
  useEffect(() => {
    if (account.status === 'connected') {
      api.refreshFolders().then(setFolders).catch((error) => onNotice({ message: error.message, error: true }))
    }
  }, [account.status])
  useEffect(() => {
    let active = true
    const refresh = () => {
      api.syncJobs().then((items) => {
        if (!active) return
        setJobs(items)
        const latest = items[0]
        if (latest && ['completed', 'partial'].includes(latest.status) && completedJobRef.current !== latest.id) {
          completedJobRef.current = latest.id
          onLibraryChanged()
        }
      }).catch(() => undefined)
      api.folders().then((items) => { if (active) setFolders(items) }).catch(() => undefined)
      api.classificationOverview().then((data) => { if (active) setClassificationPending(data.pending) }).catch(() => setClassificationPending(null))
      api.classificationJobs().then((items) => {
        if (!active) return
        setClassificationJobs(items)
        const latest = items[0]
        if (latest && ['completed', 'cancelled', 'failed'].includes(latest.status) && completedClassificationRef.current !== `${latest.id}:${latest.updated_at}`) {
          completedClassificationRef.current = `${latest.id}:${latest.updated_at}`
          onLibraryChanged()
        }
      }).catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [onLibraryChanged])
  const refreshFolders = async () => {
    try { setFolders(await api.refreshFolders()); setSelectedFolderIds(null) }
    catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  const toggleFolder = (id: string) => setSelectedFolderIds((current) => {
    const selected = current ?? folders.map((folder) => folder.id)
    return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
  })
  const running = jobs.some((job) => ['queued', 'running'].includes(job.status))
  const classify = async () => { try { await api.startClassification(); onNotice({ message: '主题整理已启动；规则无法确定时会自动调用已配置的大模型。' }) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }
  const classificationRunning = classificationJobs.some((job) => ['queued', 'running'].includes(job.status))
  const latestClassification = classificationJobs[0]
  return <div className="subpage"><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> SYNC CENTER</div><h1>同步中心</h1><p>把知乎收藏安全地保存到你的本地资料库。</p></div><button className="button button-soft" onClick={() => document.getElementById('sync-import')?.click()}><Upload size={16} /> 导入 Markdown</button><input id="sync-import" className="visually-hidden" type="file" accept=".md,.markdown,.txt" onChange={(e) => { onImport(e.target.files?.[0]); e.currentTarget.value = '' }} /></div>
    <div className="sync-account-card"><div className="sync-account-icon"><Bookmark size={21} /></div><div className="sync-account-copy"><strong>{account.profile?.name || (account.status === 'connected' ? '知乎账号已验证' : '知乎账号连接')}</strong><span>{account.message || '用知乎 App 扫码登录。'}</span></div>{account.status === 'connected' ? <><span className="status-badge status-connected"><i /> 已验证</span><button className="button button-soft" onClick={async () => { try { const result = await api.disconnectAccount(); setAccount(result); setFolders([]); setSelectedFolderIds(null); onNotice({ message: result.message }) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }}>退出</button></> : <button className="button button-primary" onClick={() => setLoginOpen(true)}>登录知乎</button>}</div>
    {loginOpen && <ZhihuLoginDialog onClose={() => { setLoginOpen(false); refreshAccount() }} onConnected={onLoginConnected} />}
    <div className="sync-setup-grid"><div className="panel sync-mode-panel"><div className="panel-title"><h2>同步方式</h2><span>选择同步范围</span></div><button onClick={() => setMode('incremental')} className={`sync-mode-option ${mode === 'incremental' ? 'chosen' : ''}`}><span className="radio-dot" /><span><strong>增量同步</strong><small>检查新收藏和可识别的内容变化</small></span><ArrowDownToLine size={17} /></button><button onClick={() => setMode('full')} className={`sync-mode-option ${mode === 'full' ? 'chosen' : ''}`}><span className="radio-dot" /><span><strong>全量同步</strong><small>重新核对已选收藏夹中的全部内容</small></span><Clock3 size={17} /></button><div className="sync-mode-foot"><CircleHelp size={14} />同步后自动依次整理新增文章和话题；远端编辑建议通过全量同步核对。</div><button className="button button-primary sync-start" disabled={account.status !== 'connected' || running || folders.length === 0 || (selectedFolderIds !== null && selectedFolderIds.length === 0)} onClick={() => onSync(mode, selectedFolderIds ?? [])}>开始{mode === 'full' ? '全量' : '增量'}同步 <ArrowRight size={15} /></button></div><div className="panel folder-panel"><div className="panel-title"><h2>同步目标</h2><button className="button button-soft" onClick={refreshFolders} disabled={account.status !== 'connected'}>刷新收藏夹</button></div><div className="folder-placeholder"><div className="folder-placeholder-icon"><FolderOpen size={20} /></div><div><strong>资料保存目录</strong><p>可以在「设置」中输入运行后端的机器上的路径</p></div></div>{folders.length ? <div className="folder-options"><label className="folder-option"><input type="checkbox" checked={selectedFolderIds === null || selectedFolderIds.length === folders.length} onChange={() => setSelectedFolderIds(null)} /><span>全部收藏夹</span></label>{folders.map((folder) => <label className="folder-option" key={folder.id}><input type="checkbox" checked={selectedFolderIds === null || selectedFolderIds.includes(folder.id)} onChange={() => toggleFolder(folder.id)} /><span>{folder.name}</span><small>{folder.article_count} 篇已保存</small></label>)}</div> : <div className="folder-empty"><div className="folder-empty-art"><FolderOpen size={29} /></div><strong>暂无收藏夹</strong><span>连接知乎账号后点击“刷新收藏夹”。</span></div>}</div></div>
    <div className="panel jobs-panel"><div className="panel-title"><h2>最近任务</h2><span>{jobs.length} 条记录</span></div>{jobs.length ? <div className="job-list">{jobs.map((job) => <div className="job-row" key={String(job.id)}><span className="job-icon"><ArrowDownToLine size={16} /></span><div><strong>{job.mode === 'full' ? '全量同步' : '增量同步'}</strong><small>{String(job.status)} · {String(job.updated_at)}</small></div><span>{String(job.message || '')}</span>{['completed', 'partial'].includes(job.status) && <button className="button button-soft" onClick={classify} disabled={classificationRunning}>自动整理主题</button>}</div>)}</div> : <div className="jobs-empty"><Clock3 size={17} /><span>还没有同步记录</span></div>}</div>
    <div className="panel jobs-panel classification-panel"><div className="panel-title"><h2>主题整理</h2><div className="panel-title-actions"><button className="button button-primary" onClick={classify} disabled={classificationRunning}> {classificationRunning ? '整理中…' : `整理新增文章（${classificationPending ?? 0}）`} </button>{latestClassification && ['queued', 'running'].includes(latestClassification.status) && <button className="button button-soft" onClick={async () => { try { await api.cancelClassification(latestClassification.id) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }}>取消</button>}</div></div>{latestClassification ? <div className="classification-progress"><strong>{latestClassification.status === 'completed' ? '整理完成' : latestClassification.status === 'cancelled' ? '已取消' : latestClassification.status === 'interrupted' ? '等待重试' : '规则与大模型整理主题'}</strong><span>{latestClassification.processed}/{latestClassification.total} 篇 · 已归类 {latestClassification.classified} · 待整理 {latestClassification.pending} · 跳过 {latestClassification.skipped} · 失败 {latestClassification.failed}</span>{latestClassification.error_summary && <small>{latestClassification.error_summary}</small>}{['failed', 'interrupted', 'cancelled'].includes(latestClassification.status) && <button className="button button-soft" onClick={async () => { try { await api.retryClassification(latestClassification.id) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }}>重试</button>}</div> : <div className="jobs-empty"><Tags size={17} /><span>首次整理已有文章，之后只处理新增文章；规则无法确定时会自动调用已配置的大模型。</span></div>}</div>
  </div>
}

function CategoriesPage({ categories, refresh, onNotice, onCategoryOpen }: { categories: Category[]; refresh: () => void; onNotice: (notice: Notice) => void; onCategoryOpen: () => void }) {
  const [adding, setAdding] = useState(false)
  const [parentId, setParentId] = useState<number | undefined>()
  const [name, setName] = useState('')
  const [classificationJobs, setClassificationJobs] = useState<ClassificationJob[]>([])
  const [classificationPending, setClassificationPending] = useState<number | null>(null)
  const completedClassificationRef = useRef('')
  useEffect(() => {
    let active = true
    const load = () => {
      api.classificationOverview().then((data) => { if (active) setClassificationPending(data.pending) }).catch(() => { if (active) setClassificationPending(null) })
      return api.classificationJobs().then((items) => {
      if (!active) return
      setClassificationJobs(items)
      const latest = items[0]
      if (latest && ['completed', 'cancelled', 'failed'].includes(latest.status) && completedClassificationRef.current !== `${latest.id}:${latest.updated_at}`) {
        completedClassificationRef.current = `${latest.id}:${latest.updated_at}`
        refresh()
      }
      }).catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const classify = async () => { try { await api.startClassification(); onNotice({ message: '主题整理已启动；规则无法确定时会自动调用已配置的大模型。' }); setClassificationJobs(await api.classificationJobs()) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }
  const latestClassification = classificationJobs[0]
  const classificationRunning = classificationJobs.some((job) => ['queued', 'running'].includes(job.status))
  const parents = categories.filter((item) => !item.parent_id)
  const add = async () => {
    if (!name.trim()) return
    try { await api.createCategory(name.trim(), parentId); setName(''); setAdding(false); setParentId(undefined); refresh(); onNotice({ message: '分类已创建' }) }
    catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  const remove = async (category: Category) => {
    if (!window.confirm(`删除「${category.name}」？文章将移入待整理。`)) return
    try { await api.deleteCategory(category.id); refresh(); onNotice({ message: '分类已删除' }) }
    catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  return <div className="subpage categories-page"><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> ORGANIZE YOUR LIBRARY</div><h1>主题分类</h1><p>首次整理已有文章，之后只处理新增文章。</p></div><div className="page-title-actions"><button className="button button-primary" onClick={classify} disabled={classificationRunning}><Tags size={16} /> {classificationRunning ? '整理中…' : `整理新增文章（${classificationPending ?? 0}）`}</button>{latestClassification && ['queued', 'running'].includes(latestClassification.status) && <button className="button button-soft" onClick={() => api.cancelClassification(latestClassification.id).catch((e) => onNotice({ message: e.message, error: true }))}>取消</button>}<button className="button button-soft" onClick={() => { setAdding(true); setParentId(undefined) }}><Plus size={16} /> 新建分类</button></div></div>
    {adding && <div className="panel add-category-panel"><div className="panel-title"><h2>创建分类</h2><button className="icon-button" onClick={() => setAdding(false)}><X size={16} /></button></div><div className="form-row"><label>分类名称<input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="例如：人工智能" maxLength={80} /></label><label>上级分类<select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : undefined)}><option value="">作为一级分类</option>{parents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button button-primary" onClick={add}>保存</button></div></div>}
    <div className="category-summary"><div className="summary-icon"><Tags size={19} /></div><div><strong>{parents.length} 个一级主题</strong><span>{categories.length} 个分类 · 可创建两级主题</span></div><div className="summary-side">分类由你掌握 <span>✳</span></div></div>
    <div className="category-manage-list">{parents.map((parent, index) => { const children = categories.filter((item) => item.parent_id === parent.id); return <div className="category-manage-card" key={parent.id}><div className={`manage-category-icon hue-${index % 5}`}><Hash size={18} /></div><div className="manage-category-main"><div className="manage-category-heading"><h3><Link to={`/?category=${parent.id}`} onClick={onCategoryOpen} title={`查看${parent.name}的全部文章`}>{parent.name}</Link></h3><Link className="category-count-link" to={`/?category=${parent.id}`} onClick={onCategoryOpen}>{parent.article_count} 篇</Link></div><div className="subcategory-row">{children.map((child) => <span className="subcategory-chip" key={child.id}><Link to={`/?category=${child.id}`} onClick={onCategoryOpen} title={`查看${child.name}的文章`}>{child.name}<small>{child.article_count}</small></Link><button aria-label={`删除${child.name}`} onClick={() => remove(child)}><X size={12} /></button></span>)}<button className="add-subcategory" onClick={() => { setAdding(true); setParentId(parent.id) }}><Plus size={13} /> 添加子分类</button></div></div><button className="icon-button manage-delete" aria-label={`删除${parent.name}`} onClick={() => remove(parent)}><MoreHorizontal size={18} /></button></div> })}</div>
    {parents.length === 0 && <div className="empty-state compact"><div className="empty-illustration"><Tags size={31} /></div><h3>还没有主题分类</h3><p>创建大类和小类，开始整理你的文章。</p><button className="button button-primary" onClick={() => setAdding(true)}><Plus size={16} /> 创建第一个分类</button></div>}
  </div>
}

function SettingsPage({ settings, onSaved, onNotice, onConnect }: { settings: LibrarySettings | null; onSaved: (settings: LibrarySettings) => void; onNotice: (notice: Notice) => void; onConnect: () => Promise<void> }) {
  const [path, setPath] = useState(settings?.library_dir || '')
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null)
  const [baseUrl, setBaseUrl] = useState(settings?.ai_base_url || '')
  const [chatModel, setChatModel] = useState(settings?.ai_chat_model || '')
  const [embeddingModel, setEmbeddingModel] = useState(settings?.ai_embedding_model || '')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  useEffect(() => { if (settings?.library_dir) setPath(settings.library_dir) }, [settings?.library_dir])
  useEffect(() => { setBaseUrl(settings?.ai_base_url || ''); setChatModel(settings?.ai_chat_model || ''); setEmbeddingModel(settings?.ai_embedding_model || '') }, [settings?.ai_base_url, settings?.ai_chat_model, settings?.ai_embedding_model])
  useEffect(() => {
    let active = true
    const refreshAccount = () => api.account().then((status) => { if (active) setAccountStatus(status) }).catch((error) => {
      if (active) onNotice({ message: (error as Error).message, error: true })
    })
    refreshAccount()
    const timer = window.setInterval(refreshAccount, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [onNotice])
  const accountConnected = accountStatus?.status === 'connected'
  const accountLabel = accountConnected ? '已连接' : !accountStatus ? '检查中' : accountStatus.status === 'restoring' ? '校验中' : accountStatus.status === 'network_error' ? '暂无法校验' : ['awaiting_login', 'challenge_required'].includes(accountStatus.status) ? '待验证' : accountStatus.status === 'expired' ? '会话失效' : '未连接'
  const save = async () => {
    try { const result = await api.updateSettings(path); const latest = await api.settings(); onSaved({ ...latest, library_dir: result.library_dir }) }
    catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  const saveAI = async () => {
    try {
      await api.updateAISettings({ base_url: baseUrl, chat_model: chatModel, embedding_model: embeddingModel, api_key: apiKey || undefined, clear_api_key: clearApiKey })
      setApiKey('')
      setClearApiKey(false)
      onSaved(await api.settings())
      onNotice({ message: '模型配置已保存。' })
    } catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  return <div className="subpage"><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> PREFERENCES</div><h1>设置</h1><p>管理你的资料存储和连接状态。</p></div></div><div className="settings-stack"><div className="panel settings-panel"><div className="panel-title"><div><h2>本地资料目录</h2><span>文章与数据库保存在本机，不会自动上传</span></div><div className="settings-section-icon"><FolderOpen size={18} /></div></div><label className="setting-label">目录路径<input value={path} onChange={(e) => setPath(e.target.value)} placeholder="例如 /home/you/Documents/ZhihuLibrary" /></label><p className="setting-help">路径由本地服务所在的电脑访问。修改目录后会切换到该目录中的资料库，不会自动搬移旧文章。</p><button className="button button-primary" onClick={save}>保存目录</button></div><div className="panel settings-panel"><div className="panel-title"><div><h2>知乎账号</h2><span>在知微页面扫码并完成必要的知乎验证</span></div><div className="settings-section-icon warm"><Bookmark size={18} /></div></div><div className="setting-status-row"><span className={`status-badge ${accountConnected ? 'status-connected' : 'status-muted'}`}><i /> {accountLabel}</span><button className="button button-soft" onClick={onConnect}>{accountConnected ? '查看连接' : '连接知乎'}</button></div>{accountStatus?.message && <p className="setting-help">{accountStatus.message}</p>}</div><div className="panel settings-panel"><div className="panel-title"><div><h2>AI 与知识问答</h2><span>可连接 OpenAI 兼容服务，或使用本机 OpenCode 免费模型</span></div><div className="settings-section-icon lilac"><Bot size={18} /></div></div><div className="ai-settings-grid"><label className="setting-label">API 地址<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="opencode://local 或 https://api.example.com/v1" /></label><label className="setting-label">聊天模型<input value={chatModel} onChange={(e) => setChatModel(e.target.value)} placeholder={baseUrl === 'opencode://local' ? 'opencode/space-bunny-free' : '模型名称'} /></label><label className="setting-label">本地 Embedding 模型<input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} placeholder="留空使用 BAAI/bge-small-zh-v1.5" /></label>{baseUrl !== 'opencode://local' && <label className="setting-label">API Key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings?.ai_api_key_set ? '已保存；留空表示不更改' : '由本地后端保存'} autoComplete="new-password" /></label>}</div>{settings?.ai_api_key_set && <label className="clear-key-option"><input type="checkbox" checked={clearApiKey} onChange={(e) => setClearApiKey(e.target.checked)} /> 清除本机已保存的 API Key</label>}<p className="setting-help">提交知识库问题时会发送检索片段；你点击智能分类时会发送当前文章内容片段。{baseUrl === 'opencode://local' ? '通过本机 OpenCode CLI 调用所选模型；文章片段会发送给模型服务商。' : '密钥保存在本机权限受限的配置文件中。'} 语义向量在本机生成；在知识问答页面建立或更新索引。</p><button className="button button-primary" onClick={saveAI}>保存模型配置</button></div></div></div>
}

function formatDate(value: string) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

export default App

function QuestionsPage({ categories, onNotice }: { categories: Category[]; onNotice: (notice: Notice) => void }) {
  const [items, setItems] = useState<Question[]>([])
  const [total, setTotal] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()
  const filters = new URLSearchParams(location.search)
  const search = filters.get('q') || ''
  const categoryValue = Number(filters.get('category'))
  const category = Number.isInteger(categoryValue) && categoryValue > 0 ? categoryValue : undefined
  const pending = filters.get('pending') === '1'
  const pageValue = Number(filters.get('page'))
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1
  const pageSize = [12, 24, 48, 100].includes(Number(filters.get('size'))) ? Number(filters.get('size')) : 24
  const filtersRef = useRef(location.search)
  filtersRef.current = location.search
  const updateFilters = (values: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(filtersRef.current)
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    filtersRef.current = next.toString()
    navigate(`/questions?${next}`, { replace })
  }
  const selectCategory = (id?: number, unclassified = false) => updateFilters({ category: id ? String(id) : undefined, pending: unclassified ? '1' : undefined, page: undefined })
  const [overview, setOverview] = useState<import('./types').QuestionOverview | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [manualArticle, setManualArticle] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [job, setJob] = useState<QuestionJob | null>(null)
  useEffect(() => {
    setLoading(true)
    setLoadError('')
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api.questions(search, category, pending, page, pageSize, controller.signal).then((data) => {
        if (active) { setItems(data.items); setTotal(data.total) }
      }).catch((error) => { if (active) setLoadError(error.message) }).finally(() => { if (active) setLoading(false) })
    }, search ? 250 : 0)
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [search, category, pending, page, pageSize, refresh])
  useEffect(() => {
    const controller = new AbortController()
    setOverviewError('')
    api.questionOverview(controller.signal).then(setOverview).catch((error) => {
      if (!controller.signal.aborted) setOverviewError(error.message)
    })
    return () => controller.abort()
  }, [refresh, categories, onNotice])
  useEffect(() => {
    api.questionJobs().then((jobs) => { if (jobs[0]) api.questionJob(jobs[0].id).then(setJob).catch(() => setJob(jobs[0])); else setJob(null) }).catch(() => undefined)
  }, [refresh])
  useEffect(() => {
    if (!job || job.status !== 'running') return
    const timer = window.setInterval(() => api.questionJob(job.id).then((updated) => {
      setJob(updated)
      if (updated.status !== 'running') setRefresh((value) => value + 1)
    }).catch(() => undefined), 2000)
    return () => window.clearInterval(timer)
  }, [job?.id, job?.status])
  const action = async (run: () => Promise<unknown>, message: string) => {
    try { await run(); onNotice({ message }); setRefresh((value) => value + 1) }
    catch (error) { onNotice({ message: (error as Error).message, error: true }) }
  }
  const topicCategories = overview?.categories || []
  const selectedCategory = topicCategories.find((item) => item.id === category)
  const selectedParent = topicCategories.find((item) => item.id === selectedCategory?.parent_id)
  const sectionTitle = pending ? '待整理的问题' : selectedCategory ? [selectedParent?.name, selectedCategory.name].filter(Boolean).join(' / ') : '全部问题'
  const categoryButton = (item: typeof topicCategories[number], child = false) => <button
    key={item.id} type="button" className={`topic-category${child ? ' topic-category-child' : ''}${category === item.id && !pending ? ' active' : ''}`}
    aria-pressed={category === item.id && !pending} onClick={() => selectCategory(item.id)}>
    {child ? <span className="topic-branch" /> : <Hash size={15} />}<span>{item.name}</span><small>{item.question_count}</small>
  </button>
  return <div className="subpage questions-page">
    <div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> QUESTION COLLECTION</div><h1>话题汇总</h1><p>按分类发现感兴趣的问题，再阅读你收藏的回答。</p></div><span className="article-total"><strong>{overview?.total ?? '—'}</strong> 个问题</span></div>
    <details className="topic-management">
      <summary><Settings2 size={15} /> 管理与整理 <ChevronDown size={14} /></summary>
    <div className="question-actions"><button className="button button-soft" onClick={() => action(() => api.backfillQuestions(), '已检查并修复话题关联')}>回填已有回答</button><button className="button button-primary" disabled={job?.status === 'running'} onClick={() => action(async () => setJob(await api.startQuestionJob()), '话题整理已启动')}>✦ 整理话题（{overview?.organize_articles ?? 0}）</button></div>
    {job && <div className="panel question-job"><strong>整理任务：{job.status}</strong><span>{job.processed} / {job.total} · 已归类 {job.classified} · 待整理 {job.pending} · 失败 {job.failed}</span>{job.error_summary && <small>最近失败：{job.error_summary}</small>}{job.items && job.items.length > 0 && <details className="question-failures"><summary>查看失败话题（{job.items.length}）</summary><ul>{job.items.slice(0, 30).map((failed) => <li key={failed.question_id}><Link to={`/questions/${failed.question_id}`}>问题 {failed.question_id}</Link>：{failed.reason}</li>)}</ul>{job.items.length > 30 && <small>仅展示前 30 条</small>}</details>}{job.status === 'running' && <button className="button button-soft" onClick={() => action(() => api.cancelQuestionJob(job.id), '已请求取消')}>取消</button>}{job.status !== 'running' && job.failed > 0 && <button className="button button-soft" onClick={() => action(async () => setJob(await api.retryQuestionJob(job.id)), '失败项已重试')}>重试失败项</button>}</div>}
    <div className="question-attach"><input placeholder="知乎问题链接" value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} /><input placeholder="本地专栏文章 ID" value={manualArticle} onChange={(event) => setManualArticle(event.target.value)} /><button className="button button-soft" disabled={!manualUrl.trim() || !manualArticle.trim()} onClick={() => action(async () => { await api.manualQuestionLink(manualUrl.trim(), manualArticle.trim()); setManualUrl(''); setManualArticle('') }, '已手动关联专栏文章')}>关联文章到话题</button></div>
    </details>
    <div className="topic-browser">
      <aside className="topic-directory panel" aria-label="话题分类">
        <div className="topic-directory-heading"><Tags size={16} /><h2>话题分类</h2></div>
        <p>选择分类，查看相关问题</p>
        <nav>
          <button className={`topic-category${!category && !pending ? ' active' : ''}`} aria-pressed={!category && !pending} onClick={() => selectCategory()}><LayoutGrid size={15} /><span>全部问题</span><small>{overview?.total ?? '—'}</small></button>
          <button className={`topic-category${pending ? ' active' : ''}`} aria-pressed={pending} onClick={() => selectCategory(undefined, true)}><Clock3 size={15} /><span>待整理</span><small>{overview?.pending ?? '—'}</small></button>
          <div className="topic-directory-divider" />
          {!overview && !overviewError && <p className="topic-directory-note">正在读取分类…</p>}
          {overviewError && <div className="topic-directory-note"><p>{overviewError}</p><button className="button button-soft" onClick={() => setRefresh((value) => value + 1)}>重试</button></div>}
          {topicCategories.filter((item) => !item.parent_id).map((parent) => <div className="topic-category-group" key={parent.id}>
            {categoryButton(parent)}
            {topicCategories.filter((item) => item.parent_id === parent.id).map((child) => categoryButton(child, true))}
          </div>)}
          {overview && topicCategories.length === 0 && <p className="topic-directory-note">还没有分类。可在主题分类中创建，再整理话题。</p>}
        </nav>
        <Link className="topic-manage-link" to="/categories"><Plus size={13} /> 管理分类</Link>
      </aside>
      <section className="topic-results" aria-label="分类下的问题" aria-busy={loading}>
        <div className="topic-results-heading"><div><span>浏览问题</span><h2>{sectionTitle}</h2></div><small aria-live="polite">{loading ? '读取中…' : `${total} 个问题`}</small></div>
        <div className="question-filters">
          <label className="topic-search"><Search size={15} /><input aria-label="搜索当前分类的问题" placeholder="搜索当前分类的问题…" value={search} onChange={(event) => updateFilters({ q: event.target.value || undefined, page: undefined }, true)} />{search && <button aria-label="清除搜索" onClick={() => updateFilters({ q: undefined, page: undefined }, true)}><X size={14} /></button>}</label>
          {search && <span className="topic-search-hint">当前分类内搜索</span>}
        </div>
        {loading ? <div className="topic-status"><LoaderCircle className="spin" size={19} /> 正在读取问题…</div> : loadError ? <div className="topic-status"><p>{loadError}</p><button className="button button-soft" onClick={() => setRefresh((value) => value + 1)}>重新加载</button></div> : <>
          <div className="topic-question-list">{items.map((item) => <Link className="topic-question-row panel" to={`/questions/${item.id}${location.search}`} key={item.id}>
            <span className="topic-question-icon"><CircleHelp size={19} /></span>
            <div className="topic-question-copy"><small>{item.category_id ? [item.category_parent_name, item.category_name].filter(Boolean).join(' / ') : '待整理'}</small><h3>{item.title}</h3><p><BookOpen size={13} /> {item.answer_count} 篇已收藏回答{item.article_count > 0 && <span> · {item.article_count} 篇关联文章</span>}</p></div>
            <span className="topic-question-open">查看回答 <ChevronRight size={16} /></span>
          </Link>)}</div>
          {items.length === 0 && <div className="panel topic-empty"><CircleHelp size={28} /><h3>{search ? '没有找到匹配的问题' : '这个分类下还没有问题'}</h3><p>{search ? '试试其他关键词，或清除搜索条件。' : pending ? '已归类的问题可以从左侧分类中浏览。' : '可以查看其他分类，或展开「管理与整理」整理待分类问题。'}</p><button className="button button-soft" onClick={() => updateFilters({ category: undefined, pending: undefined, q: undefined, page: undefined })}>查看全部问题</button></div>}
          <Pagination page={page} total={total} pageSize={pageSize} onPageChange={(value) => updateFilters({ page: String(value) })} onPageSizeChange={(value) => updateFilters({ size: String(value), page: undefined })} />
        </>}
      </section>
    </div>
  </div>
}

function QuestionDetail({ categories, onNotice }: { categories: Category[]; onNotice: (notice: Notice) => void }) {
  const { id = '' } = useParams()
  const location = useLocation()
  const [item, setItem] = useState<Question | null>(null)
  useWorkspaceTitle(item?.title)
  const [articleId, setArticleId] = useState('')
  const refresh = () => api.question(id).then(setItem).catch((error) => onNotice({ message: error.message, error: true }))
  useEffect(() => { refresh() }, [id])
  if (!item) return <div className="subpage">正在读取话题…</div>
  const mutate = async (run: () => Promise<unknown>) => { try { await run(); await refresh() } catch (error) { onNotice({ message: (error as Error).message, error: true }) } }
  return <div className="subpage question-detail"><Link to={`/questions${location.search}`} className="button button-soft"><ArrowLeft size={15} /> 返回话题</Link><div className="panel question-header"><small>知乎问题 · {item.id}</small><h1>{item.title}</h1><a href={item.url} target="_blank" rel="noopener noreferrer">打开知乎原问题 <ArrowRight size={14} /></a><label>本地话题分类<select value={item.category_id ?? ''} onChange={(event) => mutate(() => api.classifyQuestion(id, event.target.value ? Number(event.target.value) : null))}><option value="">待整理</option>{categories.filter((category) => category.parent_id || !categories.some((child) => child.parent_id === category.id)).map((category) => <option key={category.id} value={category.id}>{category.parent_id ? `${categories.find((parent) => parent.id === category.parent_id)?.name || ''} / ` : ''}{category.name}</option>)}</select></label>{item.classification_reason && <p>{item.classification_reason}</p>}{Boolean(item.classification_locked) && <button className="button button-soft" onClick={() => mutate(() => api.resuggestQuestion(id))}>重新建议分类</button>}</div>
    <h2>已收藏回答</h2><div className="question-contents">{item.contents?.filter((content) => content.kind === 'answer').map((content) => <Link className="panel question-content" to={`/read/${encodeURIComponent(content.id)}`} key={content.id}><strong>{content.title}</strong><small>{content.author || '作者未知'} · {content.link_source === 'answer_url' ? '回答链接验证' : '已保存问题信息'}</small><p>{content.excerpt}</p></Link>)}</div>
    <h2>关联专栏文章</h2><div className="question-contents">{item.contents?.filter((content) => content.kind === 'article').map((content) => <div className="panel question-content" key={content.id}><Link to={`/read/${encodeURIComponent(content.id)}`}><strong>{content.title}</strong></Link><small>手动关联</small><button className="button button-soft" onClick={() => mutate(() => api.detachQuestionArticle(id, content.id))}>解除关联</button></div>)}</div><div className="question-attach"><input placeholder="输入已有专栏文章 ID" value={articleId} onChange={(event) => setArticleId(event.target.value)} /><button className="button button-soft" disabled={!articleId.trim()} onClick={() => mutate(async () => { await api.attachQuestionArticle(id, articleId.trim()); setArticleId('') })}>关联专栏文章</button></div>
  </div>
}
