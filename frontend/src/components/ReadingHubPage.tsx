import { useEffect, useState } from 'react'
import { Bookmark, BookOpen, Clock3, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { ReadingListItem } from '../types'
import type { Notice } from '../types/ui'

type ReadingHubPageProps = { onNotice: (notice: Notice) => void }

function readTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ReadingItems({ items, later, onRemove }: {
  items: ReadingListItem[]
  later: boolean
  onRemove: (item: ReadingListItem) => void
}) {
  if (!items.length) return <div className="reading-hub-empty">
    {later ? <Bookmark size={22} /> : <BookOpen size={22} />}
    <strong>{later ? '稍后阅读列表还是空的' : '还没有阅读记录'}</strong>
    <span>{later ? '在文章页面点击「稍后阅读」，把想读的资料放到这里。' : '打开一篇资料后，知微会自动记录阅读位置。'}</span>
  </div>

  return <div className="reading-hub-list">
    {items.map((item) => {
      const percent = Math.round(Math.max(0, Math.min(1, item.progress_ratio)) * 100)
      return <article className="reading-hub-item" key={item.id}>
        <Link className="reading-hub-open" to={'/read/' + encodeURIComponent(item.id)}>
          <div className="reading-hub-item-meta">
            <span>{item.kind === 'answer' ? '知乎回答' : item.kind === 'article' ? '知乎文章' : '本地资料'}</span>
            <time>{readTime(item.last_read_at)}</time>
          </div>
          <h2>{item.title || '未命名资料'}</h2>
          <p>{item.excerpt || '暂无摘要，打开资料继续阅读。'}</p>
          <div className="reading-hub-progress">
            <div className="reading-hub-progress-track"><span style={{ width: percent + '%' }} /></div>
            <small>{percent}% 已读</small>
          </div>
        </Link>
        {later && <button className="reading-hub-remove" onClick={() => onRemove(item)} aria-label="移出稍后阅读"><X size={15} />移出</button>}
      </article>
    })}
  </div>
}

export function ReadingHubPage({ onNotice }: ReadingHubPageProps) {
  const [tab, setTab] = useState<'recent' | 'later'>('recent')
  const [recent, setRecent] = useState<ReadingListItem[]>([])
  const [later, setLater] = useState<ReadingListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    Promise.all([api.recentlyRead(), api.readLater()]).then(([recentItems, laterItems]) => {
      if (!active) return
      setRecent(recentItems)
      setLater(laterItems)
    }).catch((error) => {
      if (active) {
        setError((error as Error).message)
        onNotice({ message: (error as Error).message, error: true })
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refreshKey, onNotice])

  const removeFromLater = async (item: ReadingListItem) => {
    try {
      const updated = await api.setReadLater(item.id, false)
      setLater((items) => items.filter((candidate) => candidate.id !== item.id))
      setRecent((items) => items.map((candidate) => candidate.id === item.id
        ? { ...candidate, read_later: updated.read_later } : candidate))
      onNotice({ message: '已从稍后阅读移除' })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    }
  }

  const items = tab === 'recent' ? recent : later

  return <section className="reading-hub-page">
    <header className="reading-hub-heading">
      <div>
        <span className="eyebrow">READING WORKSPACE</span>
        <h1>阅读进度</h1>
        <p>从上次停下的位置继续，把想读的资料集中管理。</p>
      </div>
      <button className="button button-soft" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>
        <RefreshCw size={14} />刷新
      </button>
    </header>
    <div className="reading-hub-tabs" role="tablist" aria-label="阅读列表">
      <button role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'selected' : ''} onClick={() => setTab('recent')}>
        <Clock3 size={15} />最近阅读<span>{recent.length}</span>
      </button>
      <button role="tab" aria-selected={tab === 'later'} className={tab === 'later' ? 'selected' : ''} onClick={() => setTab('later')}>
        <Bookmark size={15} />稍后阅读<span>{later.length}</span>
      </button>
    </div>
    {loading
      ? <div className="reading-hub-loading"><LoaderCircle size={18} className="spin" />正在整理阅读记录…</div>
      : error
        ? <div className="reading-hub-empty"><strong>暂时无法读取阅读记录</strong><span>{error}</span><button className="button button-soft" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div>
        : <ReadingItems items={items} later={tab === 'later'} onRemove={(item) => void removeFromLater(item)} />}
  </section>
}
