import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FolderOpen, MoreHorizontal, Plus, Sparkles, Tags, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import type { Category, ClassificationJob } from '../../types'
import { Button, IconButton } from '../../design-system/Button'
import { PageHeader } from '../../design-system/PageHeader'
import type { Notice } from '../../app/types'

export function CategoriesPage({ categories, refresh, onNotice, onCategoryOpen }: { categories: Category[]; refresh: () => void; onNotice: (notice: Notice) => void; onCategoryOpen: () => void }) {
  const [adding, setAdding] = useState(false)
  const [parentId, setParentId] = useState<number | undefined>()
  const [name, setName] = useState('')
  const [classificationJobs, setClassificationJobs] = useState<ClassificationJob[]>([])
  const [classificationPending, setClassificationPending] = useState<number | null>(null)
  const completedClassificationRef = useRef('')
  useEffect(() => {
    let active = true
    const load = () => {
      api.classificationOverview().then((data) => { if (active) setClassificationPending(data.pending) }).catch(() => {
        if (active) setClassificationPending(null)
      })
      return api.classificationJobs().then((items) => {
        if (!active) return
        setClassificationJobs(items)
        const latest = items[0]
        if (latest && ['completed', 'cancelled', 'failed'].includes(latest.status) && completedClassificationRef.current !== latest.id + ':' + latest.updated_at) {
          completedClassificationRef.current = latest.id + ':' + latest.updated_at
          refresh()
        }
      }).catch(() => undefined)
    }
    void load()
    const timer = window.setInterval(load, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const classify = async () => {
    try {
      await api.startClassification()
      onNotice({ message: '主题整理已启动；规则无法确定时会自动调用已配置的大模型。' })
      setClassificationJobs(await api.classificationJobs())
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    }
  }
  const latestClassification = classificationJobs[0]
  const classificationRunning = classificationJobs.some((job) => ['queued', 'running'].includes(job.status))
  const parents = categories.filter((item) => !item.parent_id)
  const add = async () => {
    if (!name.trim()) return
    try {
      await api.createCategory(name.trim(), parentId)
      setName('')
      setAdding(false)
      setParentId(undefined)
      refresh()
      onNotice({ message: '主题已创建' })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    }
  }
  const remove = async (category: Category) => {
    if (!window.confirm('删除「' + category.name + '」？文章将移入待整理。')) return
    try {
      await api.deleteCategory(category.id)
      refresh()
      onNotice({ message: '主题已删除' })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    }
  }
  return <div className="subpage categories-page">
    <PageHeader
      eyebrow="KNOWLEDGE TAXONOMY"
      title="主题目录"
      description="用少量清晰的主题组织文章，让知识更容易被找到。"
      actions={<>
        <Button onClick={() => { setAdding(true); setParentId(undefined) }}><Plus size={15} /> 新建主题</Button>
        <Button variant="primary" disabled={classificationRunning} onClick={classify}>
          <Sparkles size={14} /> {classificationRunning ? '整理中…' : '智能整理'}
        </Button>
      </>}
    />

    {adding && <section className="panel add-category-panel">
      <div className="panel-title">
        <h2>创建主题</h2>
        <IconButton label="关闭创建表单" onClick={() => setAdding(false)}><X size={16} /></IconButton>
      </div>
      <div className="form-row">
        <label>主题名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void add()} placeholder="例如：人工智能" maxLength={80} /></label>
        <label>上级主题<select value={parentId ?? ''} onChange={(event) => setParentId(event.target.value ? Number(event.target.value) : undefined)}>
          <option value="">作为一级主题</option>{parents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <Button variant="primary" disabled={!name.trim()} onClick={() => void add()}>保存主题</Button>
      </div>
    </section>}

    <div className="category-overview-strip">
      <div className="category-overview-icon"><Tags size={18} /></div>
      <div><strong>{parents.length} 个一级主题</strong><span>{categories.length} 个分类 · 最多支持两级主题</span></div>
      <div className="category-overview-count"><strong>{classificationPending ?? '—'}</strong><span>篇待整理</span></div>
    </div>

    {latestClassification && <section className="panel classification-status">
      <div className="classification-status-copy">
        <strong>{classificationRunning ? '正在整理新增文章' : '最近一次智能整理'}</strong>
        <span>{latestClassification.status} · 已处理 {latestClassification.processed} / {latestClassification.total} · 已归类 {latestClassification.classified} · 失败 {latestClassification.failed}</span>
      </div>
      {classificationRunning
        ? <Button size="small" onClick={() => api.cancelClassification(latestClassification.id).catch((error) => onNotice({ message: error.message, error: true }))}>取消任务</Button>
        : latestClassification.failed > 0
          ? <Button size="small" onClick={() => api.retryClassification(latestClassification.id).then(refresh).catch((error) => onNotice({ message: error.message, error: true }))}>重试失败项</Button>
          : <span className="badge grey">已结束</span>}
    </section>}

    {parents.length > 0
      ? <div className="category-grid">
        {parents.map((parent, index) => {
          const children = categories.filter((item) => item.parent_id === parent.id)
          return <section className="panel category-card category-card-v2" key={parent.id}>
            <div className="category-top">
              <div className={'icon-soft hue-' + (index % 5)}><FolderOpen size={19} /></div>
              <span className="category-article-count">{parent.article_count} 篇文章</span>
              <details className="category-overflow">
                <summary aria-label={'更多操作：' + parent.name} title="更多操作"><MoreHorizontal size={17} /></summary>
                <div className="category-overflow-menu">
                  <button type="button" onClick={() => { setAdding(true); setParentId(parent.id) }}><Plus size={13} /> 添加子主题</button>
                  <button type="button" className="danger" onClick={() => void remove(parent)}><Trash2 size={13} /> 删除主题</button>
                </div>
              </details>
            </div>
            <h3><Link to={'/library?category=' + parent.id} onClick={onCategoryOpen}>{parent.name}</Link></h3>
            <p>{children.length ? children.length + ' 个子主题' : '还没有子主题'}</p>
            <div className="category-subtopics">
              {children.map((child) => <span className="subcategory-chip" key={child.id}>
                <Link to={'/library?category=' + child.id} onClick={onCategoryOpen}>{child.name}<small>{child.article_count}</small></Link>
                <button type="button" aria-label={'删除' + child.name} onClick={() => void remove(child)}><X size={12} /></button>
              </span>)}
              <button className="add-subcategory" type="button" onClick={() => { setAdding(true); setParentId(parent.id) }}><Plus size={13} /> 添加子主题</button>
            </div>
            <div className="category-foot">
              <Link to={'/library?category=' + parent.id} onClick={onCategoryOpen}>查看主题文章 <ArrowRight size={14} /></Link>
            </div>
          </section>
        })}
      </div>
      : <div className="empty-state compact">
        <div className="empty-illustration"><Tags size={31} /></div>
        <h3>还没有主题</h3>
        <p>创建几个清晰的大类，再逐步添加子主题。</p>
        <Button variant="primary" onClick={() => { setAdding(true); setParentId(undefined) }}><Plus size={15} /> 创建第一个主题</Button>
      </div>}
  </div>
}

