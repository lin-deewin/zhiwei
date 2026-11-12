import {IconButton} from '@astryxdesign/core/IconButton'
import {Heading} from '@astryxdesign/core/Heading'
import {HStack} from '@astryxdesign/core/HStack'
import {Selector} from '@astryxdesign/core/Selector'
import {EmptyState} from '@astryxdesign/core/EmptyState'
import {PageHeader} from './shared/PageHeader'
import {TextInput} from '@astryxdesign/core/TextInput'
import {Button} from '@astryxdesign/core/Button'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight, BookOpen, FileText, Hash, LayoutGrid,
  LoaderCircle, Search, Trash2, Upload,
} from 'lucide-react'
import { api } from '../api'
import type { Category, Content } from '../types'
import { articleExcerpt, formatDate } from '../utils/format'
import { DeleteArticleDialog } from './DeleteArticleDialog'
import { Pagination } from './Pagination'
import './LibraryPage.css'

type Notice = { message: string; error?: boolean } | null

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function LibraryPage({ search, categories, refresh, onSearchChange, onImport, onNotice, onLibraryChanged }: {
  search: string; categories: Category[]; refresh: number; onSearchChange: (search: string) => void; onImport: (file?: File) => void;
  onNotice: (notice: Notice) => void; onLibraryChanged: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const urlSearch = params.get('q') || ''
  const categoryValue = positiveInt(params.get('category'), 0)
  const category = categoryValue || undefined
  const categoryFromUrl = Boolean(category)
  const pendingOnly = params.get('pending') === '1'
  const page = positiveInt(params.get('page'), 1)
  const requestedPageSize = positiveInt(params.get('page_size'), 24)
  const pageSize = [12, 24, 48, 100].includes(requestedPageSize) ? requestedPageSize : 24
  const sourceValue = params.get('source') || 'all'
  const source = ['all', 'answer', 'article', 'local'].includes(sourceValue) ? sourceValue : 'all'
  const sortValue = params.get('sort') || 'synced'
  const sort = ['synced', 'title'].includes(sortValue) ? sortValue : 'synced'
  const view = params.get('view') === 'list' ? 'list' : 'grid'
  const [items, setItems] = useState<Content[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Content | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const lastSearchLocation = useRef<string | null>(null)

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search)
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    navigate({ pathname: location.pathname, search: query ? '?' + query : '', hash: location.hash }, { replace: true })
  }
  const setPage = (next: number) => updateParams({ page: next > 1 ? String(next) : null })
  const setSource = (next: string) => updateParams({ source: next === 'all' ? null : next, page: null })
  const setSort = (next: string) => updateParams({ sort: next === 'synced' ? null : next, page: null })
  const setPageSize = (next: number) => updateParams({ page_size: next === 24 ? null : String(next), page: null })
  const setView = (next: 'grid' | 'list') => updateParams({ view: next === 'grid' ? null : next })
  const updateSearch = (next: string) => {
    onSearchChange(next)
    updateParams({ q: next.trim() ? next : null, page: null })
  }

  useEffect(() => {
    if (lastSearchLocation.current === location.search) return
    lastSearchLocation.current = location.search
    if (search !== urlSearch) onSearchChange(urlSearch)
  }, [location.search, search, urlSearch, onSearchChange])
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
  const description = search ? `包含「${search}」的资料` : pendingOnly ? '尚未归入主题的外部资料' : currentCategory ? `主题：${currentCategory.name}` : '集中阅读你收藏和导入的外部资料。个人观点请写入个人笔记。'
  const triggerImport = () => document.getElementById('md-upload')?.click()

  return <div className="library-page">
    {deleteTarget && <DeleteArticleDialog title={deleteTarget.title} busy={deletingId !== null} error={deleteError} onCancel={() => setDeleteTarget(null)} onConfirm={() => { void removeArticle(deleteTarget) }} />}
    <input id="md-upload" className="visually-hidden" type="file" accept=".md,.markdown,.txt" onChange={(e) => { onImport(e.target.files?.[0]); e.currentTarget.value = '' }} />

    <PageHeader title={title} description={description} actions={<><span className="article-total">{total} 篇资料</span><Button label="导入 Markdown" variant="primary" icon={<Upload />} onClick={triggerImport} /></>} />
    <HStack className="library-toolbar" hAlign="start" gap={3} wrap="wrap" vAlign="end" paddingBlockEnd={6}>
      <TextInput label="搜索文章库" type="search" placeholder="搜索标题或正文…" value={search} onChange={updateSearch} hasClear startIcon={Search} width="min(100%, 32rem)" />
      <Selector label="文章来源" value={source} onChange={setSource} options={[{value:'all',label:'全部来源'},{value:'answer',label:'知乎回答'},{value:'article',label:'知乎文章'},{value:'local',label:'本地导入'}]} />
      <Selector label="资料排序" value={sort} onChange={setSort} options={[{value:'synced',label:'最近同步'},{value:'title',label:'标题 A–Z'}]} />
      <IconButton tooltip="卡片视图" label="卡片视图" variant={view === 'grid' ? 'primary' : 'secondary'} icon={<LayoutGrid />} aria-pressed={view === 'grid'} onClick={() => setView('grid')} />
      <IconButton tooltip="列表视图" label="列表视图" variant={view === 'list' ? 'primary' : 'secondary'} icon={<FileText />} aria-pressed={view === 'list'} onClick={() => setView('list')} />
    </HStack>

    {loading ? <div className="loading-state"><LoaderCircle className="spin" /> 正在打开你的资料库…</div> : visibleItems.length === 0 ? <EmptyLibrary searched={Boolean(search || pendingOnly || category)} onImport={triggerImport} /> : <div className={view === 'grid' ? 'article-grid' : 'article-list'}>
      {visibleItems.map((item) => <ArticleCard key={item.id} item={item} view={view} onDelete={(content) => { setDeleteError(''); setDeleteTarget(content) }} deleting={deletingId === item.id} deleteDisabled={deletingId !== null} />)}
    </div>}
    <Pagination page={page} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
    {(categoryFromUrl || pendingOnly) && <button className="filter-reset" onClick={() => navigate('/')}>清除主题筛选</button>}
  </div>
}

function ArticleCard({ item, view, onDelete, deleting, deleteDisabled }: { item: Content; view: 'grid' | 'list'; onDelete: (item: Content) => void; deleting: boolean; deleteDisabled: boolean }) {
  return <div className="article-card-container"><Link to={`/read/${encodeURIComponent(item.id)}`} className={'article-card' + (view === 'list' ? ' as-list' : '')}>
    <div className="article-card-body"><div className="article-card-meta"><span className="type-label"><BookOpen size={12} /> {item.kind === 'answer' ? '知乎回答' : item.id.startsWith('local_') ? '本地导入' : '知乎文章'}</span><span className="date-label">{formatDate(item.last_synced_at || item.updated_at)}</span></div><Heading level={3}>{item.title}</Heading><p>{articleExcerpt(item.title, item.excerpt) || '打开文章，开始阅读。'}</p><div className="article-card-footer"><span className="topic-pill"><Hash size={12} /><span>{item.category_name ? [item.category_parent_name, item.category_name].filter(Boolean).join(' / ') : '待整理'}</span></span><span className="read-link">继续阅读 <ArrowRight size={13} /></span></div></div>
  </Link><IconButton icon={deleting ? <LoaderCircle className="spin" /> : <Trash2 />} label={`删除文章：${item.title}`} variant="destructive" className="article-delete-button" type="button" aria-label={`删除文章：${item.title}`} tooltip="删除本地文章" isDisabled={deleteDisabled} onClick={() => onDelete(item)} /></div>
}

export function EmptyLibrary({ searched, onImport }: { searched: boolean; onImport: () => void }) {
  return <EmptyState title={searched ? '没有找到匹配的资料' : '资料库还空着，导入第一篇资料吧'} description={searched ? '试试其他关键词，或清除筛选条件。' : '支持 Markdown 文件。导入后可以在这里阅读和整理。'} icon={<BookOpen />} actions={!searched && <Button label="选择 Markdown 文件" variant="primary" icon={<Upload />} onClick={onImport} />} />
}
