import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight, BookOpen, ChevronDown, FileText, Hash, LayoutGrid,
  LoaderCircle, Search, Trash2, Upload, X,
} from 'lucide-react'
import { api } from '../api'
import type { Category, Content } from '../types'
import { formatDate } from '../utils/format'
import { DeleteArticleDialog } from './DeleteArticleDialog'
import { Pagination } from './Pagination'

type Notice = { message: string; error?: boolean } | null

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
