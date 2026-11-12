import { useEffect, useState } from 'react'
import { api } from '../api'

export function MarkdownPanel() {
  const [directory, setDirectory] = useState('')
  const [automatic, setAutomatic] = useState(false)
  const [data, setData] = useState<Awaited<ReturnType<typeof api.markdownPreview>> | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { api.markdownConfiguration().then((c) => { setDirectory(c.directory); setAutomatic(c.auto_sync) }).catch((e) => setError((e as Error).message)) }, [])
  const refresh = async () => { const d = await api.markdownPreview(); setData(d); setSelected(d.items.filter((x) => ['new', 'update'].includes(x.status)).map((x) => x.path)) }
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await action() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const labels: Record<string, string> = { imported: '导入', exported: '导出', unchanged: '一致', conflict: '冲突', skipped: '跳过', error: '失败' }
  const summary = (items: { status: string }[]) => items.reduce<Record<string, number>>((out, x) => { out[x.status] = (out[x.status] || 0) + 1; return out }, {})
  return <section className="panel knowledge-controls"><h2>Markdown 与 Obsidian 互通</h2><p>选择后端机器上的 Markdown 目录。可批量导入，或导出文章、阅读笔记、高亮批注、独立个人笔记、主题页和研究成果；个人笔记标签、稳定 ID 与研究证据快照随文件保留。</p><label>目录路径<input value={directory} onChange={(e) => { setDirectory(e.target.value); setData(null) }} /></label><label><input type="checkbox" checked={automatic} onChange={(e) => setAutomatic(e.target.checked)} />每两分钟同步无冲突修改（冲突和外部删除不会自动覆盖本地资料）</label>
    <div className="knowledge-actions"><button className="button button-soft" disabled={busy || !directory.trim()} onClick={() => void run(async () => { await api.configureMarkdown(directory, automatic); await refresh(); setMessage('目录配置已保存') })}>保存目录配置</button><button className="button button-soft" disabled={busy} onClick={() => void run(refresh)}>扫描外部变化</button><button className="button button-primary" disabled={busy} onClick={() => void run(async () => { const d = await api.exportMarkdown(); setMessage(Object.entries(summary(d.items)).map(([k, n]) => `${labels[k] || k} ${n} 项`).join('，')); await refresh() })}>导出全部资料</button></div>
    {busy && <p role="status">正在处理文件…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data && <><p>正在扫描：{data.directory}</p><div className="markdown-change-list">{data.items.map((x) => <label key={x.path}><input type="checkbox" checked={selected.includes(x.path)} disabled={busy || !['new', 'update', 'adopt'].includes(x.status)} onChange={() => setSelected(selected.includes(x.path) ? selected.filter((p) => p !== x.path) : [...selected, x.path])} /><span>{x.path}</span><strong>{({ new: '新文档', update: '外部修改', adopt: '需要确认接管', conflict: '冲突，保留双方', export: '本地修改待导出', unchanged: '一致', missing: '外部已删除，本地保留', error: '无法读取', foreign: '其他资料库' } as Record<string, string>)[x.status] || x.status}</strong>{x.message && <small>{x.message}</small>}{x.status === 'conflict' && x.record_hash && x.file_hash && <button type="button" className="button button-soft" disabled={busy} onClick={() => { if (window.confirm('请先在外部文件中完成合并。继续会备份双方正文，再将外部版本写入本地；历史笔记版本保留。')) void run(async () => { const d = await api.importMarkdownFiles([x.path], { [x.path]: x.file_hash! }, { [x.path]: x.record_hash! }); setMessage(Object.entries(summary(d.items)).map(([k, n]) => `${labels[k] || k} ${n} 项`).join('，')); await refresh() }) }}>已人工合并，备份双方后导入</button>}</label>)}</div><button className="button button-primary" disabled={busy || !selected.length} onClick={() => void run(async () => { const d = await api.importMarkdownFiles(selected, Object.fromEntries(data.items.filter((x) => x.file_hash).map((x) => [x.path, x.file_hash!]))); setMessage(Object.entries(summary(d.items)).map(([k, n]) => `${labels[k] || k} ${n} 项`).join('，')); await refresh() })}>导入所选变化（{selected.length}）</button></>}
    <small>新文档默认作为本地文章导入；已导出的独立个人笔记按稳定 ID 回写正文、标题和标签，并保留本地来源快照。支持 UTF-8、YAML 标题/作者/来源及本地图片。已有导出文件按 ID 更新。文件和本地同时修改时请先人工合并；相对路径越界和符号链接会被拒绝。</small>
  </section>
}
