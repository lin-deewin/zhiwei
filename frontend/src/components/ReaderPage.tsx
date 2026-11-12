import {IconButton} from '@astryxdesign/core/IconButton'
import {ProgressBar} from '@astryxdesign/core/ProgressBar'
import {CategorySelector} from './shared/CategorySelector'
import {Button} from '@astryxdesign/core/Button'
import { Children, createElement, isValidElement, memo, useEffect, useRef, useState, type ReactNode, type HTMLAttributes, type ElementType } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import {
  ArrowLeft, ArrowRight, Bookmark, Check, ChevronDown, CircleHelp,
  Clock3, FolderOpen, LoaderCircle, Trash2,
} from 'lucide-react'
import { api } from '../api'
import type { Category, Content, ReadingBlock, ReadingContext, ReadingProgress } from '../types'
import type { Notice } from '../types/ui'
import { useWikiLinks, wikiPlugin } from '../utils/wiki_markdown'
import { formatDate } from '../utils/format'
import { DeleteArticleDialog } from './DeleteArticleDialog'
import { EmptyLibrary } from './LibraryPage'
import { ReaderWorkspace } from './ReaderWorkspace'
import { useWorkspaceTitle } from './WorkspaceTabs'

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
  const [readingProgress, setReadingProgress] = useState<ReadingProgress | null>(null)
  const [progressContentId, setProgressContentId] = useState<string | null>(null)
  const progressRestored = useRef(false)
  const [loading, setLoading] = useState(true)
  const [infoVisible, setInfoVisible] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    progressRestored.current = false
    setProgressContentId(null)
    Promise.all([api.content(id), api.readingContext(id), api.readingProgress(id).catch(() => null)]).then(([content, context, progress]) => {
      if (!active) return
      setItem({ ...content, markdown: context.markdown, file_missing: context.file_missing })
      setReading(context)
      setReadingProgress(progress)
      setProgressContentId(id)
      setLoading(false)
    }).catch((error) => {
      if (active) onNotice({ message: (error as Error).message, error: true })
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])
  useEffect(() => {
    if (loading || progressContentId !== id || !readingProgress || progressRestored.current) return
    progressRestored.current = true
    const frame = window.requestAnimationFrame(() => {
      const block = readingProgress.block_id
        ? document.querySelector<HTMLElement>(`[data-reading-block-id="${CSS.escape(readingProgress.block_id)}"]`)
        : null
      if (block) {
        const blockTop = block.getBoundingClientRect().top + window.scrollY
        window.scrollTo({ top: Math.max(0, blockTop - 96), behavior: 'instant' })
        return
      }
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      window.scrollTo({ top: maxScroll * readingProgress.progress_ratio, behavior: 'instant' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [id, loading, progressContentId, readingProgress])

  useEffect(() => {
    if (loading || progressContentId !== id || !item || !reading || !progressRestored.current) return
    let timer: number | null = null
    const save = (updateState = true, keepalive = false) => {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight
      const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0
      const visibleBlock = Array.from(document.querySelectorAll<HTMLElement>('[data-reading-block-id]'))
        .find((block) => {
          const rect = block.getBoundingClientRect()
          return rect.bottom > 0 && rect.top < window.innerHeight
        })
      const pending = api.saveReadingProgress(id, {
        progress_ratio: ratio,
        scroll_y: window.scrollY,
        block_id: visibleBlock?.dataset.readingBlockId || null,
      }, keepalive)
      if (updateState) void pending.then(setReadingProgress).catch(() => undefined)
      else void pending.catch(() => undefined)
    }
    const persist = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => save(true), 800)
    }
    const pageHide = () => save(false, true)
    window.addEventListener('scroll', persist, { passive: true })
    window.addEventListener('pagehide', pageHide)
    return () => {
      window.removeEventListener('scroll', persist)
      window.removeEventListener('pagehide', pageHide)
      if (timer !== null) save(false, true)
    }
  }, [id, loading, progressContentId, item?.id, reading?.revision_id])

  if (loading) return <div className="loading-state"><LoaderCircle className="spin" /> 正在打开文章…</div>
  if (!item) return <EmptyLibrary searched onImport={() => navigate('/')} />
  const toggleReadLater = async () => {
    if (!readingProgress) return
    try {
      const updated = await api.setReadLater(item!.id, !readingProgress.read_later)
      setReadingProgress(updated)
      onNotice({ message: updated.read_later ? '已加入稍后阅读' : '已从稍后阅读移除' })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    }
  }

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
      <button className="back-link" onClick={() => navigate(-1)}><ArrowLeft size={15} /> 返回上一页</button>
      <div className="reader-toolbar-actions">
      <Button icon={<Bookmark size={14} fill={readingProgress?.read_later ? 'currentColor' : 'none'} />} label={readingProgress?.read_later ? '已加入稍后阅读' : '稍后阅读'} variant="secondary"  aria-pressed={Boolean(readingProgress?.read_later)} isDisabled={!readingProgress} onClick={() => void toggleReadLater()}>
        {readingProgress?.read_later ? '已加入稍后阅读' : '稍后阅读'}
      </Button>
      <IconButton icon={<ChevronDown size={18} className={infoVisible ? 'is-expanded' : ''} />} label={infoVisible ? '收起文章信息' : '展开文章信息'} tooltip={infoVisible ? '收起文章信息' : '展开文章信息'} variant="ghost" className="reader-info-toggle" aria-expanded={infoVisible} aria-controls="reader-article-info" onClick={() => setInfoVisible((visible) => !visible)} />
      <IconButton label="删除文章" tooltip="删除本地文章" icon={<Trash2 />} variant="ghost" className="reader-delete-button" isLoading={deleting} onClick={() => { setDeleteError(''); setDeleteDialogOpen(true) }} />
      </div>
    </div>
    <div className={`reader-layout${infoVisible ? '' : ' reader-info-collapsed'}`}><div className="reader-main"><div className="reader-kicker"><span className="reader-kicker-dot" /> {item.kind === 'answer' ? '知乎回答' : '收藏文章'} <span className="reader-kicker-sep">·</span> {formatDate(item.updated_at)}</div><h1>{item.title}</h1><div className="reader-byline"><span className="reader-author-avatar" aria-hidden="true">{(item.author || '佚').slice(0, 1)}</span><span className="reader-author">{item.author || '作者信息未知'}</span><span className="reader-byline-dot" /><span>离线阅读</span>{item.markdown && <span className="reader-duration"><Clock3 size={13} />约 {Math.max(1, Math.ceil(item.markdown.replace(/\s/g, '').length / 400))} 分钟</span>}</div>
      {readingProgress && <div className="reader-progress-summary" aria-label={`阅读进度 ${Math.round(readingProgress.progress_ratio * 100)}%`}>
        <ProgressBar label="阅读进度" value={Math.round(readingProgress.progress_ratio * 100)} isLabelHidden />
        <small>阅读进度 {Math.round(readingProgress.progress_ratio * 100)}%</small>
      </div>}
      <div className="reader-rule" />{item.file_missing ? <div className="inline-warning">正文文件暂时不可用，请检查本地资料目录。</div> : <div className="markdown-body"><ArticleMarkdown contentId={item.id} markdown={item.markdown || ''} blocks={reading?.blocks || []} /></div>}
      {reading && <ReaderWorkspace context={reading} setContext={(next) => setReading((current) => typeof next === 'function' ? current ? next(current) : current : next)} onNotice={(message, error) => onNotice({ message, error })} />}
      {item.url && <a className="original-link" href={item.url} target="_blank" rel="noreferrer">在知乎打开原文 <ArrowRight size={14} /></a>}
    </div><aside id="reader-article-info" className="reader-aside" hidden={!infoVisible}><div className="aside-card"><div className="aside-card-heading"><Bookmark size={15} /><span>文章信息</span></div><div className="aside-field"><small>本地分类</small><div><CategorySelector categories={categories} value={String(item.category_id ?? '')} onChange={async value => { try { const updated = await api.classify(item.id, value ? Number(value) : null); setItem(updated); reload() } catch (err) { onNotice({ message: (err as Error).message, error: true }) } }} />{item.category_id && <Link className="category-view-link" to={`/?category=${item.category_id}`}>查看该主题文章 <ArrowRight size={12} /></Link>}<button className="classify-ai" disabled={Boolean(item.classification_locked)} onClick={async () => { try { const result = await api.autoClassify(item.id); setItem(result.content); onNotice({ message: `分类建议：${result.reason}` }); reload() } catch (error) { onNotice({ message: (error as Error).message, error: true }) } }}>{item.classification_locked ? '已手动确认' : '✦ 智能分类'}</button>{item.classification_reason && <small className="classification-reason">{item.classification_reason}</small>}</div></div><div className="aside-field"><small>收藏夹来源</small>{item.folders?.length ? item.folders.map((folder) => /^https:\/\/www\.zhihu\.com\/collection\/\d+$/.test(folder.url || '') ? <a className="source-chip source-link" key={folder.id} href={folder.url!} target="_blank" rel="noopener noreferrer" title="在知乎打开收藏夹"><FolderOpen size={13} />{folder.name}<ArrowRight size={12} /></a> : <span className="source-chip" key={folder.id}><FolderOpen size={13} />{folder.name}</span>) : <span className="muted-text">本地导入 / 暂无记录</span>}</div><div className="aside-field"><small>本地文章 ID</small><code>{item.id}</code></div><div className="aside-field"><small>关联问题</small>{item.question && /^https:\/\/www\.zhihu\.com\/question\/\d+$/.test(item.question.url) ? <a className="source-chip source-link" href={item.question.url} target="_blank" rel="noopener noreferrer" title="在知乎打开问题"><CircleHelp size={13} />{item.question.title}<ArrowRight size={12} /></a> : <span className="muted-text">暂无问题信息</span>}</div></div><div className="offline-note"><span><Check size={15} /></span><div><strong>保存在你的设备</strong><p>正文文件位于本地资料目录，可离线阅读。</p></div></div></aside></div>
  </article>
}
