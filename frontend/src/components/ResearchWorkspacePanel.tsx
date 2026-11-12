import {CheckboxInput} from '@astryxdesign/core/CheckboxInput'
import {Selector} from '@astryxdesign/core/Selector'
import {HStack} from '@astryxdesign/core/HStack'
import {Heading} from '@astryxdesign/core/Heading'
import {useConfirm} from './shared/ConfirmationProvider'
import {TextArea} from '@astryxdesign/core/TextArea'
import {VStack} from '@astryxdesign/core/VStack'
import {TextInput} from '@astryxdesign/core/TextInput'
import {Button} from '@astryxdesign/core/Button'
import {WikiMarkdown as Markdown} from './WikiMarkdown'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import type { ResearchJob, ResearchNote, ResearchProject } from '../types'
import { nodePath, type KnowledgeNode } from '../utils/knowledge_links'


export function ResearchHistory({ note, onRestore }: { note: ResearchNote; onRestore: (n: ResearchNote) => void }) {
  const confirm = useConfirm()
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof api.researchVersions>>['items']>([])
  const [selected, setSelected] = useState('')
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof api.compareResearchVersion>> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; setComparison(null); setSelected(''); api.researchVersions(note.id).then((d) => { if (active) setVersions(d.items) }).catch((e) => { if (active) setError((e as Error).message) }); return () => { active = false } }, [note.id, note.revision])
  useEffect(() => { let active = true; setComparison(null); if (selected) api.compareResearchVersion(note.id, selected).then((d) => { if (active) setComparison(d) }).catch((e) => { if (active) setError((e as Error).message) }); return () => { active = false } }, [note.id, note.revision, selected])
  return <details className="panel"><summary>版本历史 · {versions.length} 个版本</summary><small>比较的是已保存正文。恢复会创建新版本；请先保存编辑器中的修改。</small><Selector label="历史版本" options={[({value:String(""),label:"选择版本"}),...(versions.map((v) => ({value:String(v.id),label:String(new Date(v.created_at).toLocaleString())+"·"+String(v.reason)})))]} value={String(selected)} onChange={value => setSelected(value)} />
    {comparison && <><Heading level={4}>与当前保存版本的差异</Heading><pre className="version-diff">{comparison.diff || '正文没有差异'}</pre><details><summary>查看历史正文</summary><Markdown text={comparison.version.body_md} /></details><Button label="恢复为新版本" variant="secondary"  isDisabled={busy} onClick={async () => { if (!(await confirm('恢复此版本？编辑器中的未保存修改将被替换，当前已保存版本仍保留在历史中。'))) return; setBusy(true); api.restoreResearchVersion(note.id, selected, comparison.current_revision).then(onRestore).catch((e) => setError((e as Error).message)).finally(() => setBusy(false)) }}>恢复为新版本</Button></>}{error && <p role="alert">{error}</p>}
  </details>
}

export function ResearchWorkspacePanel() {
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.projects>>['items']>([])
  const [project, setProject] = useState<ResearchProject | null>(null)
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [followup, setFollowup] = useState('')
  const [query, setQuery] = useState('')
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [job, setJob] = useState<ResearchJob | null>(null)
  const [generatedNoteId, setGeneratedNoteId] = useState<string | null>(null)
  const projectId = params.get('project')
  const jobActive = Boolean(job && (job.status === 'pending' || job.status === 'running'))
  const refresh = () => api.projects().then((d) => setItems(d.items))
  const accept = (p: ResearchProject) => { setProject(p); setChosen([...new Set(p.evidence.map((s) => s.source_id))]) }
  useEffect(() => { void refresh().catch((e) => setError((e as Error).message)) }, [])
  useEffect(() => { setGeneratedNoteId(null); let active = true; if (!projectId) { setProject(null); setChosen([]); return } api.project(projectId).then((p) => { if (active) { accept(p); setFollowup('') } }).catch((e) => { if (active) setError((e as Error).message) }); return () => { active = false } }, [projectId])
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { api.knowledgeNodes(query).then((d) => { if (active) setNodes(d.items.slice(0, 50)) }).catch(() => undefined) }, 300); return () => { active = false; window.clearTimeout(timer) } }, [query])

  useEffect(() => {
    let active = true
    setJob(null)
    if (projectId) {
      api.projectJobs(projectId).then((result) => {
        if (!active) return
        const pending = result.items.find((item) => item.status === 'pending' || item.status === 'running')
        setJob(pending || result.items[0] || null)
      }).catch((reason) => { if (active) setError((reason as Error).message) })
    }
    return () => { active = false }
  }, [projectId])
  useEffect(() => {
    if (!projectId || !jobActive || !job) return
    let active = true
    const timer = window.setInterval(() => {
      api.projectJob(projectId, job.id).then((updated) => {
        if (!active) return
        setJob(updated)
        if (updated.status === 'completed' && updated.result) {
          accept(updated.result.project)
          setFollowup('')
          setGeneratedNoteId(updated.result.note_id)
          void refresh().catch(() => undefined)
        }
      }).catch((reason) => { if (active) setError((reason as Error).message) })
    }, 1300)
    return () => { active = false; window.clearInterval(timer) }
  }, [projectId, job?.id, jobActive])
  const submitJob = (research = false) => {
    if (!project || busy || jobActive) return
    const prompt = research ? followup.trim() || project.question : followup.trim()
    if (prompt.length < 2) return
    void run(async () => {
      setGeneratedNoteId(null)
      const created = await api.startProjectJob(project.id, project.revision, prompt, research)
      setJob(created)
    })
  }
  const cancelJob = () => {
    if (!projectId || !job || !jobActive) return
    void run(async () => setJob(await api.cancelProjectJob(projectId, job.id)))
  }
  const retryJob = () => {
    if (!projectId || !job || jobActive) return
    void run(async () => {
      setGeneratedNoteId(null)
      setJob(await api.retryProjectJob(projectId, job.id))
    })
  }

  const run = async (call: () => Promise<void>) => { setBusy(true); setError(''); try { await call(); await refresh() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return <><section className="panel knowledge-controls"><Heading level={2}>持续研究工作区</Heading><p>保存研究问题、证据快照和每次追问。原文更新不会悄悄改变当前证据集；需要时可主动刷新。</p><HStack gap={3} wrap="wrap" vAlign="center" className="knowledge-actions"><Button label="新建研究" variant="secondary"  isDisabled={busy} onClick={() => setParams({})}>新建研究</Button>{items.map((p) => <Button label={p.title} variant="secondary"  key={p.id} isDisabled={busy} onClick={() => setParams({ project: p.id })}>{p.title}</Button>)}</HStack>
    {!project && <><VStack><TextInput label="项目名称" width="100%" value={title} onChange={(_value, e) => setTitle(e.target.value)} /></VStack><VStack><TextArea label="研究主问题" width="100%" value={question} onChange={(_value, e) => setQuestion(e.target.value)} /></VStack></>}
    {project && <><Heading level={3}>{project.title}</Heading><p>{project.question}</p><small>证据集与对话版本：{project.revision}</small></>}
    <Heading level={3}>选择证据资料（最多 16 份）</Heading><TextInput label="搜索资料标题或 ID" width="100%" placeholder="搜索资料标题或 ID" value={query} isDisabled={busy} onChange={(_value, e) => setQuery(e.target.value)} /><div className="knowledge-directory">{nodes.map((n) => <VStack key={n.source_id}><CheckboxInput label="·"  value={chosen.includes(n.source_id)} isDisabled={busy || (chosen.length >= 16 && !chosen.includes(n.source_id))} onChange={() => setChosen(chosen.includes(n.source_id) ? chosen.filter((id) => id !== n.source_id) : [...chosen, n.source_id])} />{n.title} {n.source_type}</VStack>)}</div><small>已选 {chosen.length} 份。未出现在搜索结果中的已选资料仍保留在下方证据集中。</small>
    <HStack gap={3} wrap="wrap" vAlign="center" className="knowledge-actions">{project ? <><Button label="保存证据集选择" variant="primary"  isDisabled={busy || jobActive || !chosen.length} onClick={() => void run(async () => accept(await api.projectEvidence(project.id, project.revision, chosen)))}>保存证据集选择</Button><Button label="刷新为当前原文" variant="secondary"  isDisabled={busy || !chosen.length} onClick={async () => { if ((await confirm('从当前原文重新提取证据快照？历史回答的出处不会改变。'))) void run(async () => accept(await api.projectEvidence(project.id, project.revision, chosen, true))) }}>刷新为当前原文</Button></> : <Button label="创建并保存研究项目" variant="primary"  isDisabled={busy || !title.trim() || question.trim().length < 2 || !chosen.length} onClick={() => void run(async () => { const p = await api.createProject(title, question, chosen); accept(p); setParams({ project: p.id }) })}>创建并保存研究项目</Button>}</HStack></section>
    {project && <><section className="panel knowledge-controls"><Heading level={3}>当前证据快照</Heading>{[...new Map(project.evidence.map((s) => [s.source_id, s])).values()].map((s) => <HStack gap={3} wrap="wrap" vAlign="center" key={s.source_id} className="knowledge-actions"><Link to={nodePath(s)}>{s.title}</Link><small>{s.source_type}</small><button disabled={busy} onClick={() => setChosen(chosen.filter((id) => id !== s.source_id))}>从选择中移除</button></HStack>)}<details><summary>展开证据片段</summary>{project.evidence.map((s) => <p key={s.chunk_id}>[{s.citation_id}] {s.title}：{s.text}</p>)}</details></section>
    <section className="panel knowledge-controls"><Heading level={3}>继续研究</Heading><TextArea label="研究追问" width="100%" aria-label="研究追问" placeholder="追问、比较观点，或说明下一篇研究笔记的目标" value={followup} isDisabled={busy} onChange={(_value, e) => setFollowup(e.target.value)} /><HStack gap={3} wrap="wrap" vAlign="center" className="knowledge-actions"><Button label="基于证据集追问" variant="primary"  isDisabled={busy || jobActive || followup.trim().length < 2} onClick={() => submitJob(false)}>基于证据集追问</Button><Button label="生成新的研究笔记" variant="secondary"  isDisabled={busy || jobActive} onClick={() => submitJob(true)}>生成新的研究笔记</Button></HStack><small>追问使用已保存的证据集，请先保存资料选择。</small>
      {job && <div className="research-job-status" role="status" aria-live="polite">
        <strong>{({ pending: '研究任务已提交', running: '正在调用模型生成', completed: '研究任务已完成', failed: '研究任务失败', cancelled: '研究任务已取消', interrupted: '服务重启，研究任务已中断' } as Record<string, string>)[job.status] || job.status}</strong>
        <small>{job.research ? '研究笔记' : '研究追问'} · {job.question}</small>
        {job.error_message && <p role="alert">{job.error_message}</p>}
        {jobActive && <Button label="取消任务" variant="secondary"  isDisabled={busy} type="button" onClick={cancelJob}>取消任务</Button>}
        {['failed', 'cancelled', 'interrupted'].includes(job.status) && <Button label="重新执行" variant="secondary"  isDisabled={busy} type="button" onClick={retryJob}>重新执行</Button>}
      </div>}</section>
    {generatedNoteId && <section className="panel knowledge-controls" role="status"><strong>研究笔记草稿已生成，已加入研究笔记列表。</strong><p>核对内容与出处后，可保存为正式笔记。</p><HStack gap={3} wrap="wrap" vAlign="center" className="knowledge-actions"><Link className="button button-primary" to={`/ask?research=${encodeURIComponent(generatedNoteId)}`}>审阅生成的笔记</Link><Link className="button button-soft" to="/knowledge?tab=assistant">查看研究笔记列表</Link></HStack></section>}
    {project.turns.map((t) => <section className="panel knowledge-result" key={t.id}><Heading level={3}>{t.question}</Heading><Markdown text={t.answer} /><details><summary>本轮出处快照 · {new Date(t.created_at).toLocaleString()}</summary>{t.sources.map((s) => <p key={s.chunk_id}>[{s.citation_id}] {s.title}：{s.text}</p>)}</details></section>)}<section className="panel knowledge-controls"><Heading level={3}>研究成果</Heading>{project.notes.map((n) => <p key={n.id}><Link to={'/ask?research=' + n.id}>{n.title}</Link> · {n.status === 'draft' ? '待审阅草稿' : '已保存'}</p>)}</section></>}
    {busy && <p role="status">正在提交请求…</p>}{error && <p className="ask-error" role="alert">{error}</p>}
  </>
}
