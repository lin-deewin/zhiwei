import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, FileText, RefreshCw, Sparkles, Tags } from 'lucide-react'
import { api } from '../api'
import type { Category, Content, LibrarySettings, SyncJob } from '../types'

type Props = { categories: Category[]; settings: LibrarySettings | null; pendingCount: number | null; refresh: number }
const fmt = (value?: string) => { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) }
const contentType = (item: Content) => item.id.startsWith('local_') ? '本地导入' : item.kind === 'answer' ? '知乎回答' : '知乎文章'

export function OverviewPage({ categories, settings, pendingCount, refresh }: Props) {
  const [articles, setArticles] = useState<Content[]>([])
  const [jobs, setJobs] = useState<SyncJob[]>([])
  const [noteCount, setNoteCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setError('')
    void Promise.allSettled([
      api.contents('', undefined, 1, false, 5, 'synced').then((data) => { if (active) setArticles(data.items) }),
      api.syncJobs().then((data) => { if (active) setJobs(data) }),
      api.searchNotes('', 1, 1).then((data) => { if (active) setNoteCount(data.total) }),
    ]).then((results) => {
      if (active && results.some((result) => result.status === 'rejected')) setError('部分数据暂时无法加载，请检查后端连接。')
    })
    return () => { active = false }
  }, [refresh])
  const parents = categories.filter((item) => !item.parent_id)
  const latest = jobs[0]
  return <div className="zv-overview">
    <div className="page-header">
      <div><div className="page-eyebrow">YOUR KNOWLEDGE · PERSONAL SPACE</div><h1>让知识，慢慢生长。</h1><p className="subtitle">整理你收藏的好内容，把灵感变成可以持续积累的认知。</p></div>
      <div className="header-actions"><Link className="btn" to="/sync"><RefreshCw size={15} /> 同步收藏</Link><Link className="btn primary" to="/library">打开文章库 <ArrowRight size={14} /></Link></div>
    </div>
    {error && <p className="zv-alert" role="alert">{error}</p>}
    <div className="stats">
      <Link className="panel stat" to="/library"><div className="metric-label"><BookOpen size={16} /> 收录文章</div><strong>{settings?.content_count ?? '—'}</strong><small>保存在本地的文章</small></Link>
      <Link className="panel stat" to="/categories"><div className="metric-label"><Tags size={16} /> 已整理主题</div><strong>{parents.length}</strong><small>一级主题分类</small></Link>
      <Link className="panel stat" to="/notes"><div className="metric-label"><FileText size={16} /> 我的笔记</div><strong>{noteCount ?? '—'}</strong><small>阅读笔记与批注</small></Link>
      <Link className="panel stat" to="/library?pending=1"><div className="metric-label"><Sparkles size={16} /> 待整理文章</div><strong>{pendingCount ?? '—'}</strong><small>等待归类的内容</small></Link>
    </div>
    <div className="overview-grid">
      <div>
        <div className="section-title"><h2>最近收录</h2><Link className="subtle-link" to="/library">查看全部 <ArrowRight size={14} /></Link></div>
        <section className="panel list-panel">{articles.length ? articles.map((item) => <Link className="article-row" to={'/read/' + encodeURIComponent(item.id)} key={item.id}>
          <div className="article-glyph glyph-green"><BookOpen size={18} /></div>
          <div className="article-row-body"><div className="article-row-title">{item.title}</div><p>{item.excerpt || '打开文章，开始阅读。'}</p>
            <div className="article-row-meta"><span>{item.category_name || '待整理'}</span><span>·</span><span>{contentType(item)}</span><span>·</span><span>{fmt(item.last_synced_at || item.updated_at)}</span></div>
          </div><ArrowRight size={15} className="zv-row-arrow" />
        </Link>) : <div className="zv-empty">还没有文章，前往同步中心或导入 Markdown 开始收藏。</div>}</section>
        <div className="section-title zv-more-section"><h2>继续探索</h2><Link className="subtle-link" to="/knowledge">我的知识空间 <ArrowRight size={14} /></Link></div>
        <Link className="panel zv-explore" to="/knowledge"><div className="icon-soft"><Sparkles size={21} /></div><div><strong>让知识之间建立连接</strong><p>用知识页、双向链接和研究笔记整理你的理解。</p></div><ArrowRight size={17} /></Link>
      </div>
      <div className="overview-right">
        <section className="panel mini-panel">
          <div className="section-title"><h2>我的主题</h2><Link className="subtle-link" to="/categories">管理 <ArrowRight size={13} /></Link></div>
          <div className="topic-list">{parents.slice(0,5).map((topic,index) => <Link className="topic-item" to={'/library?category=' + topic.id} key={topic.id}><i className="dot" style={{ background: ['#6f97b3','#9684b4','#67a186','#c6a16b','#78978d'][index%5] }} /><strong>{topic.name}</strong><small>{topic.article_count} 篇</small></Link>)}{!parents.length && <p className="zv-empty">还没有主题分类</p>}</div>
        </section>
        <section className="panel mini-panel">
          <div className="section-title"><h2>同步状态</h2><span className="badge grey">{latest?.status || '尚无任务'}</span></div>
          <div className="mini-sync"><div className="sync-icon"><RefreshCw size={21} /></div><div><strong>{latest ? (latest.status === 'completed' ? '最近同步完成' : '最近同步任务') : '等待首次同步'}</strong><small>{latest ? fmt(latest.updated_at) + ' · 下载 ' + latest.downloaded + ' 篇' : '连接知乎，保存你的收藏'}</small></div></div>
          <Link className="btn full-action" to="/sync">查看同步中心 <ArrowRight size={14} /></Link>
        </section>
      </div>
    </div>
  </div>
}
