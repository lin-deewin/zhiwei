import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api } from '../api'
import { Pagination } from './Pagination'
import { ResearchNotesList } from './KnowledgePage'

export function NotesPage({ onNotice }: { onNotice: (message: string, error?: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.searchNotes>>['items']>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [includeQuotes, setIncludeQuotes] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      api.searchNotes(query, page, pageSize, includeQuotes).then((result) => { if (active) { setItems(result.items); setTotal(result.total) } })
        .catch((error) => { if (active) onNotice((error as Error).message, true) })
        .finally(() => { if (active) setLoading(false) })
    }, query ? 250 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query, includeQuotes, page, pageSize, onNotice])
  return <div className="notes-page"><div className="page-title-row"><div><div className="eyebrow">PERSONAL NOTES</div><h1>我的笔记</h1><p>搜索自己的理解、批注和原文引用。</p></div><span className="article-total">{total} 条个人笔记与批注</span></div>
    <div className="notes-search"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="搜索笔记内容…" /><label><input type="checkbox" checked={includeQuotes} onChange={(event) => { setIncludeQuotes(event.target.checked); setPage(1) }} />包含原文引用</label></div>
    {loading && <p>正在搜索…</p>}
    <div className="notes-search-results">{items.map((item) => <Link className="panel notes-result" key={`${item.type}:${item.id}`} to={`/read/${encodeURIComponent(item.content_id)}${item.type === 'note' ? `?note=${encodeURIComponent(item.id)}` : `?annotation=${encodeURIComponent(item.id)}`}`}>
      <small>{item.type === 'note' ? '个人笔记' : '高亮批注'} · {new Date(item.updated_at).toLocaleDateString()}</small><h2>{item.title || item.quote || '未命名笔记'}</h2><p>{item.body_md || (includeQuotes ? item.quote : '')}</p><strong>{item.article_title}<ArrowRight size={14} /></strong>
    </Link>)}</div><Pagination page={page} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />
    <ResearchNotesList query={query} />
  </div>
}
