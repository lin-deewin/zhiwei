import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowRight, BookOpen, FileText, Hash, LayoutGrid, LoaderCircle, MoreHorizontal, Search, Trash2, Upload } from 'lucide-react'
import { api } from '../../api'
import type { Category, Content } from '../../types'
import { Pagination } from '../../components/Pagination'
import { DeleteArticleDialog } from '../../components/DeleteArticleDialog'
import type { Notice } from '../../app/types'
import { formatDate } from '../../shared/formatDate'
import { PageHeader } from '../../design-system/PageHeader'

export function LibraryPage({ search, categories, refresh, onSearchChange, onImport, onNotice, onLibraryChanged }: {
  search: string; categories: Category[]; refresh: number; onSearchChange: (search: string) => void; onImport: (file?: File) => void;
  onNotice: (notice: Notice) => void; onLibraryChanged: () => void
}) {
  const [items, setItems] = useState<Content[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState<number | undefined>()
  const [categoryFromUrl, setCategoryFromUrl] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>(() => window.localStorage.getItem('zhiwei-library-view') === 'grid' ? 'grid' : 'list')
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

  return <div className="library-page ui-library">
    {deleteTarget && <DeleteArticleDialog title={deleteTarget.title} busy={deletingId !== null} error={deleteError} onCancel={() => setDeleteTarget(null)} onConfirm={() => { void removeArticle(deleteTarget) }} />}
    <input id="md-upload" className="visually-hidden" type="file" accept=".md,.markdown,.txt" onChange={(event) => { onImport(event.target.files?.[0]); event.currentTarget.value = '' }} />
    <PageHeader
      eyebrow="MY LIBRARY"
      title={title === '全部文章' ? '文章库' : title}
      description="集中阅读、检索和管理你的收藏内容。"
      actions={<>
        <button className="btn" type="button" onClick={() => document.getElementById('md-upload')?.click()}><Upload size={15} /> 导入 Markdown</button>
        <Link className="btn primary" to="/sync"><ArrowDownToLine size={15} /> 同步知乎</Link>
      </>}
    />
    <div className="toolbar">
      <div className="filters">
        <label className="filter-input"><Search size={15} /><input aria-label="搜索文章或主题" type="search" placeholder="搜索文章、主题、关键词" value={search} onChange={(event) => { onSearchChange(event.target.value); setPage(1) }} /></label>
        <select className="select" aria-label="主题筛选" value={pendingOnly ? 'pending' : category || 'all'} onChange={(event) => {
          const value = event.target.value
          navigate(value === 'all' ? '/library' : value === 'pending' ? '/library?pending=1' : '/library?category=' + value)
          setPage(1)
        }}>
          <option value="all">全部内容</option><option value="pending">待整理</option>
          {categories.map((item) => <option key={item.id} value={item.id}>{item.parent_id ? '　' : ''}{item.name}</option>)}
        </select>
        <select className="select" aria-label="文章来源" value={source} onChange={(event) => { setSource(event.target.value); setPage(1) }}>
          <option value="all">全部来源</option><option value="answer">知乎回答</option><option value="article">知乎文章</option><option value="local">本地导入</option>
        </select>
      </div>
      <div className="filters">
        <select className="select" aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="synced">最近收录</option><option value="title">按标题排序</option>
        </select>
        <div className="segmented" role="group" aria-label="文章展示模式">
          <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} title="列表视图" aria-label="列表视图" onClick={() => { setView('list'); window.localStorage.setItem('zhiwei-library-view','list') }}><FileText size={15} /></button>
          <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} title="卡片视图" aria-label="卡片视图" onClick={() => { setView('grid'); window.localStorage.setItem('zhiwei-library-view','grid') }}><LayoutGrid size={15} /></button>
        </div>
      </div>
    </div>
    {loading ? <div className="loading-state"><LoaderCircle size={17} className="spin" /> 正在加载文章...</div>
      : visibleItems.length === 0 ? <EmptyLibrary searched={Boolean(search || category || pendingOnly)} onImport={() => document.getElementById('md-upload')?.click()} />
      : view === 'list' ? <section className="panel" aria-label="文章列表">
        <div className="table-head"><span>文章</span><span>主题</span><span>来源</span><span>收录时间</span><span /></div>
        {visibleItems.map((item) => <div className="table-row" key={item.id}>
          <div style={{ minWidth: 0 }}>
            <Link className="table-title" to={'/read/' + encodeURIComponent(item.id)}>{item.title}</Link>
            <div className="table-excerpt">{item.excerpt || '打开文章，开始阅读。'}</div>
          </div>
          <div><span className="tag">{item.category_name || '待整理'}</span></div>
          <span className="cell-text">{item.id.startsWith('local_') ? '本地导入' : item.kind === 'answer' ? '知乎回答' : '知乎文章'}</span>
          <span className="cell-text">{formatDate(item.last_synced_at || item.updated_at)}</span>
          <details className="zv-row-menu">
            <summary title="更多操作" aria-label={'操作：' + item.title}><MoreHorizontal size={17} /></summary>
            <button type="button" disabled={deletingId !== null} onClick={() => setDeleteTarget(item)}><Trash2 size={14} /> 删除本地文章</button>
          </details>
        </div>)}
      </section>
      : <div className="article-grid">{visibleItems.map((item,index) =>
        <ArticleCard key={item.id} item={item} index={index} view="grid"
          onDelete={(value) => { setDeleteError(''); setDeleteTarget(value) }}
          deleting={deletingId === item.id} deleteDisabled={deletingId !== null} />)}
      </div>}
    <div className="ui-footer"><p className="footer-count">共 {total} 篇文章 · 当前显示 {visibleItems.length} 篇</p>
      <Pagination page={page} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
    {(categoryFromUrl || pendingOnly) && <button className="filter-reset" onClick={() => navigate('/library')}>清除筛选</button>}
  </div>
}

const cardTones = ['tone-apricot', 'tone-sage', 'tone-lilac', 'tone-blue']

function ArticleCard({ item, index, view, onDelete, deleting, deleteDisabled }: { item: Content; index: number; view: 'grid' | 'list'; onDelete: (item: Content) => void; deleting: boolean; deleteDisabled: boolean }) {
  return <div className="article-card-container"><Link to={`/read/${encodeURIComponent(item.id)}`} className={`article-card ${cardTones[index % cardTones.length]} ${view === 'list' ? 'as-list' : ''}`}>
    <div className="article-card-body"><div className="article-card-meta"><span className="type-label"><BookOpen size={12} /> {item.kind === 'answer' ? '知乎回答' : item.id.startsWith('local_') ? '本地导入' : '知乎文章'}</span><span className="date-label">{formatDate(item.last_synced_at || item.updated_at)}</span></div><h3>{item.title}</h3><p>{item.excerpt || '打开文章，开始阅读。'}</p><div className="article-card-footer"><span className="topic-pill"><Hash size={12} /><span>{item.category_name ? [item.category_parent_name, item.category_name].filter(Boolean).join(' / ') : '待整理'}</span></span><span className="read-link">继续阅读 <ArrowRight size={13} /></span></div></div>
  </Link><button className="article-delete-button" type="button" aria-label={`删除文章：${item.title}`} title="删除本地文章" disabled={deleteDisabled} onClick={() => onDelete(item)}>{deleting ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}</button></div>
}

export function EmptyLibrary({ searched, onImport }: { searched: boolean; onImport: () => void }) {
  return <div className="empty-state"><div className="empty-illustration"><div className="empty-sun" /><div className="empty-page"><span /><span /><span /></div><div className="empty-spark">✦</div></div><h3>{searched ? '没有找到相关文章' : '这里还空着，导入第一篇文章吧'}</h3><p>{searched ? '试试其他关键词，或清除筛选条件。' : '支持 Markdown 文件。导入后可以在这里阅读和整理。'}</p>{!searched && <button className="button button-primary" onClick={onImport}><Upload size={16} /> 选择 Markdown 文件</button>}</div>
}

