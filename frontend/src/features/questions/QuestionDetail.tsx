import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { api } from '../../api'
import type { Category, Question } from '../../types'
import { useWorkspaceTitle } from '../../components/WorkspaceTabs'
import type { Notice } from '../../app/types'
import { PageHeader } from '../../design-system/PageHeader'
import { Button } from '../../design-system/Button'

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
  return <div className="subpage question-detail">
    <PageHeader
      eyebrow="QUESTION DETAIL"
      title={item.title}
      description={'知乎问题 · ' + item.id}
      actions={<>
        <Link to={'/questions' + location.search} className="btn"><ArrowLeft size={14} /> 返回话题</Link>
        <a className="btn primary" href={item.url} target="_blank" rel="noopener noreferrer">打开知乎原问题 <ArrowRight size={14} /></a>
      </>}
    />
    <section className="panel question-detail-meta">
      <label>本地话题分类
        <select value={item.category_id ?? ''} onChange={(event) => mutate(() => api.classifyQuestion(id, event.target.value ? Number(event.target.value) : null))}>
          <option value="">待整理</option>
          {categories.filter((category) => category.parent_id || !categories.some((child) => child.parent_id === category.id)).map((category) =>
            <option key={category.id} value={category.id}>{category.parent_id ? (categories.find((parent) => parent.id === category.parent_id)?.name || '') + ' / ' : ''}{category.name}</option>
          )}
        </select>
      </label>
      {item.classification_reason && <p>{item.classification_reason}</p>}
      {Boolean(item.classification_locked) && <Button onClick={() => mutate(() => api.resuggestQuestion(id))}>重新建议分类</Button>}
    </section>

    <div className="question-detail-section">
      <div className="section-title"><h2>已收藏回答</h2><span>{item.contents?.filter((content) => content.kind === 'answer').length || 0} 篇</span></div>
      <div className="question-contents">
        {item.contents?.filter((content) => content.kind === 'answer').map((content) =>
          <Link className="panel question-content" to={'/read/' + encodeURIComponent(content.id)} key={content.id}>
            <strong>{content.title}</strong><small>{content.author || '作者未知'} · {content.link_source === 'answer_url' ? '回答链接验证' : '已保存问题信息'}</small><p>{content.excerpt}</p>
          </Link>
        )}
      </div>
    </div>

    <div className="question-detail-section">
      <div className="section-title"><h2>关联专栏文章</h2><span>{item.contents?.filter((content) => content.kind === 'article').length || 0} 篇</span></div>
      <div className="question-contents">
        {item.contents?.filter((content) => content.kind === 'article').map((content) =>
          <div className="panel question-content" key={content.id}>
            <Link to={'/read/' + encodeURIComponent(content.id)}><strong>{content.title}</strong></Link>
            <small>手动关联</small>
            <Button size="small" onClick={() => mutate(() => api.detachQuestionArticle(id, content.id))}>解除关联</Button>
          </div>
        )}
      </div>
      <div className="question-attach question-detail-attach">
        <input placeholder="输入已有专栏文章 ID" value={articleId} onChange={(event) => setArticleId(event.target.value)} />
        <Button disabled={!articleId.trim()} onClick={() => mutate(async () => { await api.attachQuestionArticle(id, articleId.trim()); setArticleId('') })}>关联专栏文章</Button>
      </div>
    </div>
  </div>
