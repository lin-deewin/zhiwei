import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, ChevronDown, ChevronRight, CircleHelp, LoaderCircle, Search, Settings2, Sparkles, X } from 'lucide-react'
import { api } from '../../api'
import type { Category, Question, QuestionJob, QuestionOverview } from '../../types'
import { Pagination } from '../../components/Pagination'
import { Button } from '../../design-system/Button'
import { PageHeader } from '../../design-system/PageHeader'
import type { Notice } from '../../app/types'

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
    navigate('/questions?' + next.toString(), { replace })
  }
  const selectCategory = (id?: number, unclassified = false) => updateFilters({
    category: id ? String(id) : undefined,
    pending: unclassified ? '1' : undefined,
    page: undefined,
  })
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
      }).catch((error) => {
        if (active) setLoadError(error.message)
      }).finally(() => {
        if (active) setLoading(false)
      })
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
    api.questionJobs().then((jobs) => {
      if (jobs[0]) api.questionJob(jobs[0].id).then(setJob).catch(() => setJob(jobs[0]))
      else setJob(null)
    }).catch(() => undefined)
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
    try {
      await run()
      onNotice({ message })
      setRefresh((value) => value + 1)
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    }
  }

  const topicCategories = overview?.categories || []
  const parentCategories = topicCategories.filter((item) => !item.parent_id)
  const selectedCategory = topicCategories.find((item) => item.id === category)
  const selectedParent = topicCategories.find((item) => item.id === selectedCategory?.parent_id)
  const sectionTitle = pending
    ? '待整理的问题'
    : selectedCategory
      ? [selectedParent?.name, selectedCategory.name].filter(Boolean).join(' / ')
      : '全部问题'
  const childCategories = selectedCategory
    ? topicCategories.filter((item) => item.parent_id === (selectedCategory.parent_id || selectedCategory.id))
    : []

  return <div className="subpage questions-page">
    <PageHeader
      eyebrow="CURATED QUESTIONS"
      title="话题汇总"
      description="按主题浏览你收藏的问题，从一个好问题继续探索知识。"
      meta={<span className="question-total"><strong>{overview?.total ?? '—'}</strong> 个问题</span>}
    />

    <details className="question-management">
      <summary><Settings2 size={15} /> 管理与整理 <ChevronDown size={14} /></summary>
      <div className="question-management-body">
        <div className="question-actions">
          <Button onClick={() => action(() => api.backfillQuestions(), '已检查并修复话题关联')}>
            回填已有回答
          </Button>
          <Button variant="primary" disabled={job?.status === 'running'} onClick={() => action(async () => setJob(await api.startQuestionJob()), '话题整理已启动')}>
            <Sparkles size={14} /> 整理话题（{overview?.organize_articles ?? 0}）
          </Button>
        </div>
        {job && <div className="panel question-job">
          <div className="question-job-heading"><strong>整理任务：{job.status}</strong><span>{job.processed} / {job.total}</span></div>
          <div className="question-job-progress"><span style={{ width: (job.total ? Math.round(job.processed / job.total * 100) : 0) + '%' }} /></div>
          <small>已归类 {job.classified} · 待整理 {job.pending} · 失败 {job.failed}</small>
          {job.error_summary && <small>最近失败：{job.error_summary}</small>}
          {job.items && job.items.length > 0 && <details className="question-failures">
            <summary>查看失败话题（{job.items.length}）</summary>
            <ul>{job.items.slice(0, 30).map((failed) => <li key={failed.question_id}>
              <Link to={'/questions/' + failed.question_id}>问题 {failed.question_id}</Link>：{failed.reason}
            </li>)}</ul>
            {job.items.length > 30 && <small>仅展示前 30 条</small>}
          </details>}
          {job.status === 'running' && <Button size="small" onClick={() => action(() => api.cancelQuestionJob(job.id), '已请求取消')}>取消任务</Button>}
          {job.status !== 'running' && job.failed > 0 && <Button size="small" onClick={() => action(async () => setJob(await api.retryQuestionJob(job.id)), '失败项已重试')}>重试失败项</Button>}
        </div>}
        <div className="question-attach">
          <label><span>知乎问题链接</span><input placeholder="粘贴知乎问题链接" value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} /></label>
          <label><span>本地专栏文章 ID</span><input placeholder="输入文章 ID" value={manualArticle} onChange={(event) => setManualArticle(event.target.value)} /></label>
          <Button disabled={!manualUrl.trim() || !manualArticle.trim()} onClick={() => action(async () => {
            await api.manualQuestionLink(manualUrl.trim(), manualArticle.trim())
            setManualUrl('')
            setManualArticle('')
          }, '已手动关联专栏文章')}>关联文章</Button>
        </div>
        {overviewError && <p className="question-management-error">{overviewError}</p>}
      </div>
    </details>

    <nav className="question-topic-filter" aria-label="按主题筛选问题">
      <button type="button" className={'chip' + (!category && !pending ? ' chosen' : '')} aria-pressed={!category && !pending} onClick={() => selectCategory()}>
        全部主题 <small>{overview?.total ?? '—'}</small>
      </button>
      <button type="button" className={'chip' + (pending ? ' chosen' : '')} aria-pressed={pending} onClick={() => selectCategory(undefined, true)}>
        待整理 <small>{overview?.pending ?? '—'}</small>
      </button>
      {parentCategories.map((item) => <button
        key={item.id}
        type="button"
        className={'chip' + (category === item.id ? ' chosen' : '')}
        aria-pressed={category === item.id}
        onClick={() => selectCategory(item.id)}
      >
        {item.name} <small>{item.question_count}</small>
      </button>)}
    </nav>

    {selectedCategory && childCategories.length > 0 && <nav className="question-subtopic-filter" aria-label="按子主题筛选问题">
      <span>子主题</span>
      {childCategories.map((item) => <button
        key={item.id}
        type="button"
        className={'chip chip-subtle' + (category === item.id ? ' chosen' : '')}
        aria-pressed={category === item.id}
        onClick={() => selectCategory(item.id)}
      >{item.name} <small>{item.question_count}</small></button>)}
    </nav>}

    <div className="question-results-heading">
      <div><span>浏览问题</span><h2>{sectionTitle}</h2></div>
      <small aria-live="polite">{loading ? '读取中…' : total + ' 个问题'}</small>
    </div>

    <div className="question-filters">
      <label className="filter-input">
        <Search size={15} />
        <input aria-label="搜索当前分类的问题" placeholder="搜索当前分类的问题…" value={search} onChange={(event) => updateFilters({ q: event.target.value || undefined, page: undefined }, true)} />
        {search && <button type="button" aria-label="清除搜索" onClick={() => updateFilters({ q: undefined, page: undefined }, true)}><X size={14} /></button>}
      </label>
      {search && <span className="question-search-hint">当前分类内搜索</span>}
    </div>

    {loading
      ? <div className="question-status"><LoaderCircle className="spin" size={19} /> 正在读取问题…</div>
      : loadError
        ? <div className="panel question-status"><p>{loadError}</p><Button onClick={() => setRefresh((value) => value + 1)}>重新加载</Button></div>
        : <>
          <div className="question-card-list">
            {items.map((item) => <Link className="panel question-card" to={'/questions/' + item.id + location.search} key={item.id}>
              <span className="icon-soft question-card-icon"><CircleHelp size={19} /></span>
              <div className="question-card-copy">
                <small>{item.category_id ? [item.category_parent_name, item.category_name].filter(Boolean).join(' / ') : '待整理'}</small>
                <h3>{item.title}</h3>
                <p><BookOpen size={13} /> {item.answer_count} 篇已收藏回答{item.article_count > 0 && <span> · {item.article_count} 篇关联文章</span>}</p>
              </div>
              <span className="question-card-action">查看回答 <ChevronRight size={16} /></span>
            </Link>)}
          </div>
          {items.length === 0 && <div className="panel question-empty">
            <CircleHelp size={28} />
            <h3>{search ? '没有找到匹配的问题' : '这个主题下还没有问题'}</h3>
            <p>{search ? '试试其他关键词，或清除搜索条件。' : pending ? '已归类的问题可以从上方主题中浏览。' : '可以选择其他主题，或展开「管理与整理」整理待分类问题。'}</p>
            <Button onClick={() => updateFilters({ category: undefined, pending: undefined, q: undefined, page: undefined })}>查看全部问题</Button>
          </div>}
          <Pagination page={page} total={total} pageSize={pageSize} onPageChange={(value) => updateFilters({ page: String(value) })} onPageSizeChange={(value) => updateFilters({ size: String(value), page: undefined })} />
        </>}
  </div>
}

