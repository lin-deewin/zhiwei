import {Selector} from '@astryxdesign/core/Selector'
import {Heading} from '@astryxdesign/core/Heading'
import {TextInput} from '@astryxdesign/core/TextInput'
import {Button} from '@astryxdesign/core/Button'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { nodePath, type KnowledgeNode } from '../utils/knowledge_links'

export function GraphPanel({ sourceId, version = 0 }: { sourceId: string; version?: string | number }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.knowledgeLinks>> | null>(null)
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState<KnowledgeNode[]>([])
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.knowledgeLinks(sourceId)
      .then((result) => { if (active) { setData(result); setError('') } })
      .catch((reason) => { if (active) setError((reason as Error).message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [sourceId, version])

  useEffect(() => {
    setTarget('')
    if (!query.trim()) { setTargets([]); return }
    let active = true
    const timer = window.setTimeout(() => {
      api.knowledgeNodes(query.trim()).then((result) => {
        if (!active) return
        const excluded = new Set([sourceId, ...(data?.outgoing.map((item) => item.source_id) || [])])
        setTargets(result.items.filter((item) => !excluded.has(item.source_id)).slice(0, 30))
      }).catch(() => { if (active) setTargets([]) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query, sourceId, data?.outgoing])

  const addLink = async () => {
    if (!target || busy) return
    setBusy(true)
    setError('')
    try {
      setData(await api.addKnowledgeLink(sourceId, target))
      setTarget('')
      setQuery('')
      setTargets([])
    } catch (reason) {
      setError((reason as Error).message)
    } finally { setBusy(false) }
  }

  const removeLink = async (targetId: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.deleteKnowledgeLink(sourceId, targetId)
      setData(await api.knowledgeLinks(sourceId))
    } catch (reason) {
      setError((reason as Error).message)
    } finally { setBusy(false) }
  }

  const relationLabels: Record<string, string> = {
    explicit: '手动链接', wikilink: '正文链接', citation: '引用来源',
  }

  return <details className="knowledge-graph panel">
    <summary>知识链接 · {data?.outgoing.length || 0} 个关联 · {data?.incoming.length || 0} 个反向链接</summary>
    {loading && <p className="knowledge-graph-status" role="status">正在读取知识关系…</p>}
    {error && <p className="knowledge-graph-error" role="alert">{error}</p>}
    <section className="knowledge-graph-section">
      <Heading level={4}>关联资料 <span>{data?.outgoing.length || 0}</span></Heading>
      {data?.outgoing.map((item) => <div className="knowledge-graph-item" key={item.source_id}>
        <Link to={nodePath(item)}>{item.title}</Link>
        <small>{relationLabels[item.relation] || item.relation}</small>
        {item.relation === 'explicit' && <button type="button" disabled={busy} onClick={() => void removeLink(item.source_id)}>移除</button>}
      </div>)}
      {!loading && data && !data.outgoing.length && <p className="knowledge-graph-empty">还没有主动关联的资料。</p>}
    </section>
    <section className="knowledge-graph-section">
      <Heading level={4}>反向链接 <span>{data?.incoming.length || 0}</span></Heading>
      {data?.incoming.map((item) => <div className="knowledge-graph-item" key={item.source_id}>
        <Link to={nodePath(item)}>{item.title}</Link>
        <small>{relationLabels[item.relation] || item.relation}</small>
      </div>)}
      {!loading && data && !data.incoming.length && <p className="knowledge-graph-empty">目前没有其他知识条目引用这里。</p>}
    </section>
    {!!data?.unresolved.length && <section className="knowledge-graph-section">
      <Heading level={4}>待处理的链接 <span>{data.unresolved.length}</span></Heading>
      {data.unresolved.map((item) => <div className="knowledge-graph-unresolved" key={item.target}>
        <code>[[{item.target}]]</code>
        <small>{item.reason === 'ambiguous' ? '同名资料有多个，请改用稳定 ID' : '目标不存在或已删除'}</small>
        {item.candidates && item.candidates.length > 0 && <small>候选：{item.candidates.length} 项</small>}
      </div>)}
    </section>}
    <section className="knowledge-graph-linker">
      <Heading level={4}>建立关联</Heading>
      <TextInput label="搜索链接目标" width="100%" aria-label="搜索链接目标" placeholder="搜索文章、个人笔记或主题页…" value={query} onChange={(_value, event) => setQuery(event.target.value)} />
      <div className="knowledge-graph-link-controls">
        <Selector label="选择链接目标" options={[({value:String(""),label:String(query.trim() ? (targets.length ? '选择匹配的资料' : '没有可关联的匹配资料') : '先搜索要关联的资料')}),...(targets.map((item) => ({value:String(item.source_id),label:String(item.title)+"·"+String(item.source_type)})))]} value={String(target)} isDisabled={!targets.length || busy} onChange={value => setTarget(value)} />
        <Button label={busy ? '处理中…' : '建立链接'} variant="secondary"  type="button" isDisabled={!target || busy} onClick={() => void addLink()}>{busy ? '处理中…' : '建立链接'}</Button>
      </div>
      <small>只允许从个人笔记、主题页和研究成果发起链接。正文中的 <code>[[标题]]</code> 也会自动解析；同名目标请使用稳定 ID。</small>
    </section>
  </details>
}
