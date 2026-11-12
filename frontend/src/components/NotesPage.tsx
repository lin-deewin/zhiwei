import {EmptyState} from '@astryxdesign/core/EmptyState'
import {PageState} from './shared/PageState'
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput'
import {VStack} from '@astryxdesign/core/VStack'
import {Heading} from '@astryxdesign/core/Heading'
import {HStack} from '@astryxdesign/core/HStack'
import {TextInput} from '@astryxdesign/core/TextInput'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api } from '../api'
import { Pagination } from './Pagination'

export function NotesPage({ onNotice }: { onNotice: (message: string, error?: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.searchNotes>>['items']>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [includeQuotes, setIncludeQuotes] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      api.searchNotes(query, page, pageSize, includeQuotes).then((result) => { if (active) { setItems(result.items); setTotal(result.total) } })
        .catch((error) => { if (active) { setError((error as Error).message); onNotice((error as Error).message, true) } })
        .finally(() => { if (active) setLoading(false) })
    }, query ? 250 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query, includeQuotes, page, pageSize, onNotice, retry])
  return <div className="notes-page"><HStack gap={4} hAlign="between" vAlign="center" wrap="wrap" paddingBlockEnd={6} className="page-title-row"><div><div className="eyebrow">READING NOTES</div><Heading level={1}>阅读记录</Heading><p>按文章查看你保存的高亮、批注和阅读笔记。</p></div><span className="article-total">{total} 条阅读记录</span></HStack>
    <div className="notes-search"><TextInput label="搜索笔记内容…" width="100%" value={query} onChange={(_value, event) => { setQuery(event.target.value); setPage(1) }} placeholder="搜索笔记内容…" /><VStack><CheckboxInput label="包含原文引用"  value={includeQuotes} onChange={(_checked, event) => { setIncludeQuotes(event.target.checked); setPage(1) }} /></VStack></div>
    <PageState loading={loading} error={error} onRetry={() => setRetry(value => value + 1)} />
    {!loading && !error && !items.length && <EmptyState title={query ? '没有找到匹配的阅读记录' : '还没有阅读记录'} description="打开文章并保存高亮、批注或笔记后，就可以在这里检索。" />}
    <div className="notes-search-results">{items.map((item) => <Link className="panel notes-result" key={`${item.type}:${item.id}`} to={`/read/${encodeURIComponent(item.content_id)}${item.type === 'note' ? `?note=${encodeURIComponent(item.id)}` : `?annotation=${encodeURIComponent(item.id)}`}`}>
      <small>{item.type === 'note' ? '阅读笔记' : '高亮批注'} · {new Date(item.updated_at).toLocaleDateString()}</small><Heading level={2}>{item.title || item.quote || '未命名笔记'}</Heading><p>{item.body_md || (includeQuotes ? item.quote : '')}</p><strong>{item.article_title}<ArrowRight size={14} /></strong>
    </Link>)}</div><Pagination page={page} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />
  </div>
}
