import {EmptyState} from '@astryxdesign/core/EmptyState'
import {useWorkspaceActive} from './WorkspaceTabs'
import {useUnsavedLinkGuard} from '../hooks/useUnsavedLinkGuard'
import {TabList, Tab} from '@astryxdesign/core/TabList'
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput'
import {Card} from '@astryxdesign/core/Card'
import {Heading} from '@astryxdesign/core/Heading'
import {HStack} from '@astryxdesign/core/HStack'
import {useConfirm} from './shared/ConfirmationProvider'
import {TextArea} from '@astryxdesign/core/TextArea'
import {VStack} from '@astryxdesign/core/VStack'
import {TextInput} from '@astryxdesign/core/TextInput'
import {Button} from '@astryxdesign/core/Button'
import { useWikiLinks, wikiPlugin } from '../utils/wiki_markdown'
import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { api } from '../api'
import { ResearchWorkspacePanel } from './ResearchWorkspacePanel'
import { MarkdownPanel } from './MarkdownPanel'
import { UnsavedTopicDialog } from './UnsavedTopicDialog'
import { nodePath, type KnowledgeNode } from '../utils/knowledge_links'
import type { Category } from '../types'
import { GraphPanel } from './KnowledgeGraphPanel'
import { KnowledgePage } from './KnowledgePage'


export function KnowledgeHub({ categories, onNotice }: { categories: Category[]; onNotice: (notice: { message: string; error?: boolean }) => void }) {
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const requestedTab = params.get('tab')
  const [topics, setTopics] = useState<Awaited<ReturnType<typeof api.knowledgeTopics>>['items']>([])
  const [topic, setTopic] = useState<Awaited<ReturnType<typeof api.knowledgeTopic>> | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingTopicId, setPendingTopicId] = useState<string | null>(null)
  const bodyEditor = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState('')
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [proposal, setProposal] = useState<Awaited<ReturnType<typeof api.topicDraft>> | null>(null)
  const [draftId, setDraftId] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'assistant' | 'topics' | 'markdown' | 'projects'>(
    requestedTab === 'assistant' || requestedTab === 'topics' || requestedTab === 'markdown' || requestedTab === 'projects'
      ? requestedTab : params.get('project') ? 'projects' : 'topics',
  )
  const [assistantDirty, setAssistantDirty] = useState(false)
  const links = useWikiLinks(body)
  const topicId = params.get('topic')
  const projectId = params.get('project')
  const hasUnsavedChanges = Boolean(topic && (body !== topic.body_md || title !== topic.title))
  useEffect(() => {
    if (requestedTab === 'assistant' || requestedTab === 'topics' || requestedTab === 'markdown' || requestedTab === 'projects') setTab(requestedTab)
    else if (topicId) setTab('topics')
    else if (projectId) setTab('projects')
    else setTab('topics')
  }, [topicId, projectId, requestedTab])

  useUnsavedLinkGuard(hasUnsavedChanges && useWorkspaceActive(), '主题页有未保存的修改，离开后这些修改将丢失。继续离开？')

  const switchTab = async (next: 'assistant' | 'topics' | 'markdown' | 'projects') => {
    if (next === tab) return
    if (next !== 'topics' && hasUnsavedChanges && !(await confirm('主题页有未保存的修改，离开主题编辑区后这些修改仍只保留在当前页面状态中。确定切换？'))) return
    if (next !== 'assistant' && assistantDirty && !(await confirm('AI 研究笔记有未保存的修改，离开 AI 助手后这些修改将丢失。确定切换？'))) return
    const nextParams = new URLSearchParams(params)
    nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
    setTab(next)
  }

  const refresh = async () => setTopics((await api.knowledgeTopics()).items)
  useEffect(() => { void refresh().catch((e) => setError((e as Error).message)) }, [])
  useEffect(() => {
    if (!topicId) { setTopic(null); return }
    let active = true
    api.knowledgeTopic(topicId).then((t) => { if (active) { setTopic(t); setTitle(t.title); setBody(t.body_md); setDraftId(undefined); setProposal(null); setChosen([]); setNotice('') } }).catch((e) => { if (active) setError((e as Error).message) })
    return () => { active = false }
  }, [topicId])
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { api.knowledgeNodes(query).then((d) => { if (active) setNodes(d.items.slice(0, 50)) }).catch(() => undefined) }, 300); return () => { active = false; window.clearTimeout(timer) } }, [query, topics])
  const insertLink = (node: KnowledgeNode) => {
    setBody((current) => `${current}${current.trim() ? '\n\n' : ''}[[${node.source_id}|${node.title}]]`)
    setNotice(`已插入「${node.title}」的链接，请点击「保存主题页」使链接生效。`)
    window.requestAnimationFrame(() => {
      const editor = bodyEditor.current
      if (!editor) return
      editor.focus({ preventScroll: true })
      editor.setSelectionRange(editor.value.length, editor.value.length)
      editor.scrollTop = editor.scrollHeight
      editor.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }

  const createTopic = async () => {
    if (busy || !newTitle.trim()) return
    if (hasUnsavedChanges && !(await confirm('当前主题页有未保存修改，创建新主题会放弃这些修改。继续？'))) return
    void run(async () => {
      const created = await api.createKnowledgeTopic(newTitle.trim())
      await refresh()
      setParams({ topic: created.id })
      setNewTitle('')
    })
  }
  return <div className="subpage knowledge-page" data-view={tab}><HStack gap={4} hAlign="between" vAlign="center" wrap="wrap" paddingBlockEnd={6} className="page-title-row"><div><div className="eyebrow">AI & KNOWLEDGE WORKSPACE</div><Heading level={1}>知识工作台</Heading><p>从资料问答、跨资料研究，到主题知识沉淀与 Markdown 互通。</p></div></HStack>
    <TabList value={tab} onChange={value => { if (value === 'assistant' || value === 'topics' || value === 'projects' || value === 'markdown') void switchTab(value) }} aria-label="知识工作台功能" hasDivider>
      <Tab value="assistant" label="AI 助手" icon={<Sparkles />} />
      <Tab value="topics" label="主题与链接" />
      <Tab value="projects" label="持续研究" />
      <Tab value="markdown" label="Markdown 互通" />
    </TabList>
    {pendingTopicId && topic && <UnsavedTopicDialog title={title || topic.title} onCancel={() => setPendingTopicId(null)} onConfirm={() => { setParams({ topic: pendingTopicId }); setPendingTopicId(null) }} />}
    {tab === 'assistant' && <KnowledgePage categories={categories} embedded onDirtyChange={setAssistantDirty} />}
    {tab === 'markdown' && <MarkdownPanel />}
    {tab === 'projects' && <ResearchWorkspacePanel />}
    {tab === 'topics' && <>
    {error && <p className="ask-error" role="alert">{error}</p>}
    <section className="panel knowledge-controls"><Heading level={2}>主题知识页</Heading><HStack gap={3} wrap="wrap" vAlign="center" className="knowledge-actions"><TextInput label="新主题名称" width="100%" aria-label="新主题名称" value={newTitle} onChange={(_value, e) => setNewTitle(e.target.value)} placeholder="例如：个人知识库建设" /><Button label="创建主题页" variant="primary"  isDisabled={busy || !newTitle.trim()} onClick={createTopic}>创建主题页</Button></HStack><HStack gap={3} wrap="wrap" vAlign="center" className="knowledge-actions">{topics.map((t) => <Button label={t.title} variant="secondary" className={`button button-soft knowledge-topic-button${topicId === t.id ? ' is-selected' : ''}`} aria-pressed={topicId === t.id} key={t.id} onClick={() => { if (t.id === topic?.id) return; if (topic && (body !== topic.body_md || title !== topic.title)) setPendingTopicId(t.id); else setParams({ topic: t.id }) }}>{t.title}</Button>)}</HStack></section>
    <section className="panel knowledge-controls"><Heading level={2}>资料目录与链接</Heading><p>勾选资料用于生成 AI 更新草稿；点击资料旁的「插入双向链接」会将该资料链接加入下方正文，保存主题页后生效。</p><TextInput label="搜索文章、笔记或主题名称" width="100%" placeholder="搜索文章、笔记或主题名称" value={query} onChange={(_value, e) => setQuery(e.target.value)} /><div className="knowledge-directory">{nodes.map((n) => <div key={n.source_id}><Link to={nodePath(n)}>{n.title}</Link><small>{n.source_type} · {n.source_id}</small>{topic && n.source_id !== 'topic:' + topic.id && <><VStack><CheckboxInput label="用于 AI 整理"  value={chosen.includes(n.source_id)} isDisabled={chosen.length >= 16 && !chosen.includes(n.source_id)} onChange={() => setChosen(chosen.includes(n.source_id) ? chosen.filter((s) => s !== n.source_id) : [...chosen, n.source_id])} /></VStack><button disabled={busy} onClick={() => insertLink(n)}>插入双向链接</button></>}</div>)}</div><small>最多展示 50 项；输入标题或 ID 可定位更多资料。</small></section>
    {!topic && <VStack className="knowledge-topic-empty"><EmptyState title="选择主题页开始编辑" description="从目录选择已有主题，或创建一个主题，把资料整理为自己的知识。" /></VStack>}
    {topic && <section className="panel research-editor"><Heading level={2}>编辑主题页 <span className="knowledge-editing-topic">{topic.title}</span></Heading>{notice && <p role="status">{notice}</p>}{hasUnsavedChanges && <small role="status">有未保存修改，请保存主题页。离开页面前会再次确认。</small>}<VStack><TextInput label="标题" width="100%" value={title} onChange={(_value, e) => setTitle(e.target.value)} isDisabled={busy} /></VStack><VStack><TextArea label="Markdown 正文" width="100%" ref={bodyEditor} value={body} onChange={(_value, e) => setBody(e.target.value)} isDisabled={busy} /></VStack><HStack gap={3} wrap="wrap" vAlign="center" className="knowledge-actions"><Button label="保存主题页" variant="primary"  isDisabled={busy || !title.trim()} onClick={() => void run(async () => { const t = await api.saveKnowledgeTopic(topic.id, title, body, topic.revision, draftId); setTopic(t); setDraftId(undefined); setNotice('主题页已保存，知识链接已更新。'); onNotice({ message: `主题页「${t.title}」保存成功` }); await refresh() })}>保存主题页</Button><Button label="用所选资料生成更新草稿" variant="secondary"  isDisabled={busy || !chosen.length} onClick={() => void run(async () => { setProposal(await api.topicDraft(topic.id, chosen)) })}>用所选资料生成更新草稿</Button></HStack>
    {busy && <p role="status">正在处理…</p>}{proposal && <Card padding={6} className="panel knowledge-controls"><Heading level={3}>AI 更新建议（尚未保存）</Heading><ReactMarkdown remarkPlugins={[remarkGfm, [wikiPlugin, { links }]]} rehypePlugins={[rehypeSanitize]}>{proposal.body_md}</ReactMarkdown><Button label="将建议放入编辑器" variant="secondary"  onClick={() => { setBody(proposal.body_md); setDraftId(proposal.id); setProposal(null) }}>将建议放入编辑器</Button></Card>}
    <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, [wikiPlugin, { links }]]} rehypePlugins={[rehypeSanitize]}>{body}</ReactMarkdown></div><GraphPanel sourceId={'topic:' + topic.id} version={topic.revision} />{topic.sources.length > 0 && <details><summary>主题页证据快照</summary>{topic.sources.map((s) => <p key={s.citation_id}>[{s.citation_id}] {s.title}：{s.text}</p>)}</details>}
    </section>}
    </>}
  </div>
}
