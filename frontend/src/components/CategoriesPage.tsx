import {Selector} from '@astryxdesign/core/Selector'
import {Card} from '@astryxdesign/core/Card'
import {Heading} from '@astryxdesign/core/Heading'
import {HStack} from '@astryxdesign/core/HStack'
import {useConfirm} from './shared/ConfirmationProvider'
import {VStack} from '@astryxdesign/core/VStack'
import {TextInput} from '@astryxdesign/core/TextInput'
import {Button} from '@astryxdesign/core/Button'
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

export function CategoriesPage({ categories, refresh, onNotice, onCategoryOpen }: CategoriesPageProps) {
  const confirm = useConfirm()
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
    if (!(await confirm(`删除「${category.name}」？文章将移入待整理。`))) return
    try { await api.deleteCategory(category.id); refresh(); onNotice({ message: '分类已删除' }) }
    catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  return <div className="subpage categories-page"><HStack gap={4} hAlign="between" vAlign="center" wrap="wrap" paddingBlockEnd={6} className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> ORGANIZE YOUR LIBRARY</div><Heading level={1}>主题分类</Heading><p>首次整理已有文章，之后只处理新增文章。</p></div><HStack gap={3} wrap="wrap" vAlign="center" className="page-title-actions"><Button icon={<Tags size={16} />} label={classificationRunning ? '整理中…' : `整理新增文章（${classificationPending ?? 0}）`} variant="primary"  onClick={classify} isDisabled={classificationRunning}> {classificationRunning ? '整理中…' : `整理新增文章（${classificationPending ?? 0}）`}</Button>{latestClassification && ['queued', 'running'].includes(latestClassification.status) && <Button label="取消" variant="secondary"  onClick={() => api.cancelClassification(latestClassification.id).catch((e) => onNotice({ message: e.message, error: true }))}>取消</Button>}<Button icon={<Plus size={16} />} label="新建分类" variant="secondary"  onClick={() => { setAdding(true); setParentId(undefined) }}> 新建分类</Button></HStack></HStack>
    {adding && <Card padding={6} className="panel add-category-panel"><div className="panel-title"><Heading level={2}>创建分类</Heading><Button isIconOnly icon={<X size={16} />} label="关闭创建分类" variant="ghost" className="icon-button" onClick={() => setAdding(false)}></Button></div><div className="form-row"><VStack><TextInput label="分类名称" width="100%" hasAutoFocus value={name} onChange={(_value, e) => setName(e.target.value.slice(0, 80))} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="例如：人工智能"  /></VStack><VStack><Selector label="上级分类" options={[({value:String(""),label:"作为一级分类"}),...(parents.map((item) => ({value:String(item.id),label:String(item.name)})))]} value={String(parentId ?? '')} onChange={value => setParentId(value ? Number(value) : undefined)} /></VStack><Button label="保存" variant="primary"  onClick={add}>保存</Button></div></Card>}
    <div className="category-summary"><div className="summary-icon"><Tags size={19} /></div><div><strong>{parents.length} 个一级主题</strong><span>{categories.length} 个分类 · 可创建两级主题</span></div><div className="summary-side">分类由你掌握 <span>✳</span></div></div>
    <div className="category-manage-list">{parents.map((parent, index) => { const children = categories.filter((item) => item.parent_id === parent.id); return <div className="category-manage-card" key={parent.id}><div className={`manage-category-icon hue-${index % 5}`}><Hash size={18} /></div><div className="manage-category-main"><div className="manage-category-heading"><Heading level={3}><Link to={`/?category=${parent.id}`} onClick={onCategoryOpen} title={`查看${parent.name}的全部文章`}>{parent.name}</Link></Heading><Link className="category-count-link" to={`/?category=${parent.id}`} onClick={onCategoryOpen}>{parent.article_count} 篇</Link></div><div className="subcategory-row">{children.map((child) => <span className="subcategory-chip" key={child.id}><Link to={`/?category=${child.id}`} onClick={onCategoryOpen} title={`查看${child.name}的文章`}>{child.name}<small>{child.article_count}</small></Link><button aria-label={`删除${child.name}`} onClick={() => remove(child)}><X size={12} /></button></span>)}<button className="add-subcategory" onClick={() => { setAdding(true); setParentId(parent.id) }}><Plus size={13} /> 添加子分类</button></div></div><Button isIconOnly icon={<MoreHorizontal size={18} />} label={`删除${parent.name}`} variant="destructive" className="icon-button manage-delete" aria-label={`删除${parent.name}`} onClick={() => remove(parent)}></Button></div> })}</div>
    {parents.length === 0 && <div className="empty-state compact"><div className="empty-illustration"><Tags size={31} /></div><Heading level={3}>还没有主题分类</Heading><p>创建大类和小类，开始整理你的文章。</p><Button icon={<Plus size={16} />} label="创建第一个分类" variant="primary"  onClick={() => setAdding(true)}> 创建第一个分类</Button></div>}
  </div>
}
