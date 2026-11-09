import { Children, createElement, isValidElement, memo, useEffect, useState, type ReactNode, type HTMLAttributes, type ElementType } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { ArrowLeft, ArrowRight, Bookmark, Check, ChevronDown, CircleHelp, Clock3, FolderOpen, LoaderCircle, Trash2 } from 'lucide-react'
import { useWikiLinks, wikiPlugin } from '../../utils/wiki_markdown'
import { api } from '../../api'
import type { Category, Content, ReadingBlock, ReadingContext } from '../../types'
import { DeleteArticleDialog } from '../../components/DeleteArticleDialog'
import { EmptyLibrary } from '../library/LibraryPage'
import { ReaderWorkspace } from '../../components/ReaderWorkspace'
import { useWorkspaceTitle } from '../../components/WorkspaceTabs'
import type { Notice } from '../../app/types'
import { formatDate } from '../../shared/formatDate'

function markdownText(value: ReactNode): string {
  return Children.toArray(value).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (isValidElement<{ children?: ReactNode }>(child)) return markdownText(child.props.children)
    return ''
  }).join('')
}

const ArticleMarkdown = memo(function ArticleMarkdown({ contentId, markdown, blocks }: { contentId: string; markdown: string; blocks: ReadingBlock[] }) {
  let searchFrom = 0
  const matchedNodes = new Map<unknown, ReadingBlock>()
  const renderBlock = (Tag: ElementType) => (props: HTMLAttributes<HTMLElement> & { node?: unknown }) => {
    const text = markdownText(props.children).replace(/\s+/g, ' ').trim()
    const normalized = text.replace(/\s/g, '')
    // React may render the same Markdown node twice in development StrictMode.
    // Reuse its match instead of advancing past the original reading block.
    let found = props.node ? matchedNodes.get(props.node) : undefined
    for (let index = searchFrom; !found && index < blocks.length; index += 1) {
      const candidate = blocks[index]
      if (candidate.markable && candidate.text.replace(/\s/g, '') === normalized) {
        found = candidate
        if (props.node) matchedNodes.set(props.node, candidate)
        searchFrom = index + 1
        break
      }
    }
    const rest = { ...props }
    const children = rest.children
    delete rest.children
    delete rest.node
    return createElement(Tag, { ...rest, 'data-reading-block-id': found?.id, className: `${rest.className || ''} ${found ? 'reader-markable' : ''}` } as never, children)
  }
  const imageRenderer = ({ src = '', alt = '' }: { src?: string; alt?: string }) => {
    const localName = src.startsWith('assets/') ? src.split('/').pop() : ''
    const resolved = localName ? `/api/v1/contents/${encodeURIComponent(contentId)}/assets/${encodeURIComponent(localName)}` : src
    return <img src={resolved} alt={alt} loading="lazy" />
  }
  const links = useWikiLinks(markdown)
  return <ReactMarkdown remarkPlugins={[remarkGfm, [wikiPlugin, { links }]]} rehypePlugins={[rehypeSanitize, [rehypeHighlight, { detect: true, plainText: ['text', 'txt', 'plaintext'] }]]} components={{
    img: imageRenderer, p: renderBlock('p'), h1: renderBlock('h1'), h2: renderBlock('h2'),
    h3: renderBlock('h3'), h4: renderBlock('h4'), h5: renderBlock('h5'), h6: renderBlock('h6'),
    li: renderBlock('li'),
  }}>{markdown}</ReactMarkdown>
})

export function ReaderPage({ categories, onNotice, reload }: { categories: Category[]; onNotice: (notice: Notice) => void; reload: () => void }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState<Content | null>(null)
  useWorkspaceTitle(item?.title)
  const [reading, setReading] = useState<ReadingContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [infoVisible, setInfoVisible] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.content(id), api.readingContext(id)]).then(([content, context]) => {
      if (!active) return
      setItem({ ...content, markdown: context.markdown, file_missing: context.file_missing })
      setReading(context)
      setLoading(false)
    }).catch((error) => {
      if (active) onNotice({ message: (error as Error).message, error: true })
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])
  if (loading) return <div className="loading-state"><LoaderCircle className="spin" /> 正在打开文章…</div>
  if (!item) return <EmptyLibrary searched onImport={() => navigate('/library')} />
  const removeArticle = async () => {
    if (deleting) return
    setDeleteError('')
    setDeleting(true)
    try {
      await api.deleteContent(item.id)
      reload()
      navigate('/', { replace: true })
      onNotice({ message: '文章已从本地删除，以后同步将跳过这篇文章。' })
    } catch (error) {
      setDeleteError((error as Error).message)
      setDeleting(false)
    }
  }
  return <article className="reader-page">
    {deleteDialogOpen && <DeleteArticleDialog title={item.title} busy={deleting} error={deleteError} onCancel={() => setDeleteDialogOpen(false)} onConfirm={() => { void removeArticle() }} />}
    <div className="reader-toolbar">
      <button className="back-link" onClick={() => navigate(-1)}><ArrowLeft size={15} /> 返回文章库</button>
      <div className="reader-toolbar-actions">
      <button className="button button-soft reader-info-toggle" aria-expanded={infoVisible} aria-controls="reader-article-info" onClick={() => setInfoVisible((visible) => !visible)}>
        <Bookmark size={14} />{infoVisible ? '收起文章信息' : '展开文章信息'}<ChevronDown size={14} className={infoVisible ? 'is-expanded' : ''} />
      </button>
      <button className="button reader-delete-button" type="button" disabled={deleting} onClick={() => { setDeleteError(''); setDeleteDialogOpen(true) }}>
        {deleting ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}{deleting ? '删除中…' : '删除文章'}
      </button>
      </div>
    </div>
    <div className={`reader-layout${infoVisible ? '' : ' reader-info-collapsed'}`}><div className="reader-main"><div className="reader-kicker"><span className="reader-kicker-dot" /> {item.kind === 'answer' ? '知乎回答' : '收藏文章'} <span className="reader-kicker-sep">·</span> {formatDate(item.updated_at)}</div><h1>{item.title}</h1><div className="reader-byline"><span className="reader-author-avatar" aria-hidden="true">{(item.author || '佚').slice(0, 1)}</span><span className="reader-author">{item.author || '作者信息未知'}</span><span className="reader-byline-dot" /><span>离线阅读</span>{item.markdown && <span className="reader-duration"><Clock3 size={13} />约 {Math.max(1, Math.ceil(item.markdown.replace(/\s/g, '').length / 400))} 分钟</span>}</div>
      <div className="reader-rule" />{item.file_missing ? <div className="inline-warning">正文文件暂时不可用，请检查本地资料目录。</div> : <div className="markdown-body"><ArticleMarkdown contentId={item.id} markdown={item.markdown || ''} blocks={reading?.blocks || []} /></div>}
      {reading && <ReaderWorkspace context={reading} setContext={(next) => setReading((current) => typeof next === 'function' ? current ? next(current) : current : next)} onNotice={(message, error) => onNotice({ message, error })} />}
      {item.url && <a className="original-link" href={item.url} target="_blank" rel="noreferrer">在知乎打开原文 <ArrowRight size={14} /></a>}
    </div><aside id="reader-article-info" className="reader-aside" hidden={!infoVisible}><div className="aside-card"><div className="aside-card-heading"><Bookmark size={15} /><span>文章信息</span></div><div className="aside-field"><small>本地分类</small><div><select className="reader-category-select" value={item.category_id ?? ''} onChange={async (e) => { try { const updated = await api.classify(item.id, e.target.value ? Number(e.target.value) : null); setItem(updated); reload() } catch (err) { onNotice({ message: (err as Error).message, error: true }) } }}><option value="">待整理</option>{categories.filter((category) => category.parent_id || !categories.some((child) => child.parent_id === category.id)).map((category) => <option key={category.id} value={category.id}>{category.parent_id ? `${categories.find((parent) => parent.id === category.parent_id)?.name || ''} / ` : ''}{category.name}</option>)}</select>{item.category_id && <Link className="category-view-link" to={`/library?category=${item.category_id}`}>查看该主题文章 <ArrowRight size={12} /></Link>}<button className="classify-ai" disabled={Boolean(item.classification_locked)} onClick={async () => { try { const result = await api.autoClassify(item.id); setItem(result.content); onNotice({ message: `分类建议：${result.reason}` }); reload() } catch (error) { onNotice({ message: (error as Error).message, error: true }) } }}>{item.classification_locked ? '已手动确认' : '✦ 智能分类'}</button>{item.classification_reason && <small className="classification-reason">{item.classification_reason}</small>}</div></div><div className="aside-field"><small>收藏夹来源</small>{item.folders?.length ? item.folders.map((folder) => /^https:\/\/www\.zhihu\.com\/collection\/\d+$/.test(folder.url || '') ? <a className="source-chip source-link" key={folder.id} href={folder.url!} target="_blank" rel="noopener noreferrer" title="在知乎打开收藏夹"><FolderOpen size={13} />{folder.name}<ArrowRight size={12} /></a> : <span className="source-chip" key={folder.id}><FolderOpen size={13} />{folder.name}</span>) : <span className="muted-text">本地导入 / 暂无记录</span>}</div><div className="aside-field"><small>本地文章 ID</small><code>{item.id}</code></div><div className="aside-field"><small>关联问题</small>{item.question && /^https:\/\/www\.zhihu\.com\/question\/\d+$/.test(item.question.url) ? <a className="source-chip source-link" href={item.question.url} target="_blank" rel="noopener noreferrer" title="在知乎打开问题"><CircleHelp size={13} />{item.question.title}<ArrowRight size={12} /></a> : <span className="muted-text">暂无问题信息</span>}</div></div><div className="offline-note"><span><Check size={15} /></span><div><strong>保存在你的设备</strong><p>正文文件位于本地资料目录，可离线阅读。</p></div></div></aside></div>
  </article>
}

