import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Hash, MoreHorizontal, Plus, Tags, X } from 'lucide-react'
import { api } from '../api'
import type { Category, ClassificationJob } from '../types'
import type { Notice } from '../types/ui'

type CategoriesPageProps = {
  categories: Category[]
  refresh: () => void
  onNotice: (notice: Notice) => void
  onCategoryOpen: () => void
}

export export function CategoriesPage({ categories, refresh, onNotice, onCategoryOpen }: CategoriesPageProps) {
  const [adding, setAdding] = useState(false)
  const [parentId, setParentId] = useState<number | undefined>()
  const [name, setName] = useState('')
  const [classificationJobs, setClassificationJobs] = useState<ClassificationJob[]>([])
  const [classificationPending, setClassificationPending] = useState<number | null>(null)
  const completedClassificationRef = useRef('')
  useEffect(() => {
    let active = true
    const load = () => {
      api.classificationOverview().then((data) => { if (active) setClassificationPending(data.pending) }).catch(() => { if (active) setClassificationPending(null) })
      return api.classificationJobs().then((items) => {
      if (!active) return
      setClassificationJobs(items)
      const latest = items[0]
      if (latest && ['completed', 'cancelled', 'failed'].includes(latest.status) && completedClassificationRef.current !== `${latest.id}:${latest.updated_at}`) {
        completedClassificationRef.current = `${latest.id}:${latest.updated_at}`
        refresh()
      }
      }).catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const classify = async () => { try { await api.startClassification(); onNotice({ message: '主题整理已启动；规则无法确定时会自动调用已配置的大模型。' }); setClassificationJobs(await api.classificationJobs()) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }
  const latestClassification = classificationJobs[0]
  const classificationRunning = classificationJobs.some((job) => ['queued', 'running'].includes(job.status))
  const parents = categories.filter((item) => !item.parent_id)
  const add = async () => {
    if (!name.trim()) return
    try { await api.createCategory(name.trim(), parentId); setName(''); setAdding(false); setParentId(undefined); refresh(); onNotice({ message: '分类已创建' }) }
    catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  const remove = async (category: Category) => {
    if (!window.confirm(`删除「${category.name}」？文章将移入待整理。`)) return
    try { await api.deleteCategory(category.id); refresh(); onNotice({ message: '分类已删除' }) }
    catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  return <div className="subpage categories-page"><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> ORGANIZE YOUR LIBRARY</div><h1>主题分类</h1><p>首次整理已有文章，之后只处理新增文章。</p></div><div className="page-title-actions"><button className="button button-primary" onClick={classify} disabled={classificationRunning}><Tags size={16} /> {classificationRunning ? '整理中…' : `整理新增文章（${classificationPending ?? 0}）`}</button>{latestClassification && ['queued', 'running'].includes(latestClassification.status) && <button className="button button-soft" onClick={() => api.cancelClassification(latestClassification.id).catch((e) => onNotice({ message: e.message, error: true }))}>取消</button>}<button className="button button-soft" onClick={() => { setAdding(true); setParentId(undefined) }}><Plus size={16} /> 新建分类</button></div></div>
    {adding && <div className="panel add-category-panel"><div className="panel-title"><h2>创建分类</h2><button className="icon-button" onClick={() => setAdding(false)}><X size={16} /></button></div><div className="form-row"><label>分类名称<input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="例如：人工智能" maxLength={80} /></label><label>上级分类<select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : undefined)}><option value="">作为一级分类</option>{parents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button button-primary" onClick={add}>保存</button></div></div>}
    <div className="category-summary"><div className="summary-icon"><Tags size={19} /></div><div><strong>{parents.length} 个一级主题</strong><span>{categories.length} 个分类 · 可创建两级主题</span></div><div className="summary-side">分类由你掌握 <span>✳</span></div></div>
    <div className="category-manage-list">{parents.map((parent, index) => { const children = categories.filter((item) => item.parent_id === parent.id); return <div className="category-manage-card" key={parent.id}><div className={`manage-category-icon hue-${index % 5}`}><Hash size={18} /></div><div className="manage-category-main"><div className="manage-category-heading"><h3><Link to={`/?category=${parent.id}`} onClick={onCategoryOpen} title={`查看${parent.name}的全部文章`}>{parent.name}</Link></h3><Link className="category-count-link" to={`/?category=${parent.id}`} onClick={onCategoryOpen}>{parent.article_count} 篇</Link></div><div className="subcategory-row">{children.map((child) => <span className="subcategory-chip" key={child.id}><Link to={`/?category=${child.id}`} onClick={onCategoryOpen} title={`查看${child.name}的文章`}>{child.name}<small>{child.article_count}</small></Link><button aria-label={`删除${child.name}`} onClick={() => remove(child)}><X size={12} /></button></span>)}<button className="add-subcategory" onClick={() => { setAdding(true); setParentId(parent.id) }}><Plus size={13} /> 添加子分类</button></div></div><button className="icon-button manage-delete" aria-label={`删除${parent.name}`} onClick={() => remove(parent)}><MoreHorizontal size={18} /></button></div> })}</div>
    {parents.length === 0 && <div className="empty-state compact"><div className="empty-illustration"><Tags size={31} /></div><h3>还没有主题分类</h3><p>创建大类和小类，开始整理你的文章。</p><button className="button button-primary" onClick={() => setAdding(true)}><Plus size={16} /> 创建第一个分类</button></div>}
  </div>
}
