import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronRight, CircleHelp,
  Clock3, Hash, LayoutGrid, LoaderCircle, Plus, Search, Settings2, Tags, X,
} from 'lucide-react'
import { api } from '../api'
import type { Category, Question, QuestionJob, QuestionOverview } from '../types'
import { Pagination } from './Pagination'
import { useWorkspaceTitle } from './WorkspaceTabs'

type Notice = { message: string; error?: boolean } | null

export function QuestionsPage({ categories, onNotice }: { categories: Category[]; onNotice: (notice: Notice) => void }) {
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
  const [overview, setOverview] = useState<QuestionOverview | null>(null)
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

export function QuestionDetail({ categories, onNotice }: { categories: Category[]; onNotice: (notice: Notice) => void }) {
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
