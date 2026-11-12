import {Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell} from '@astryxdesign/core/Table'
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput'
import {HStack} from '@astryxdesign/core/HStack'
import {Heading} from '@astryxdesign/core/Heading'
import {useConfirm} from './shared/ConfirmationProvider'
import {VStack} from '@astryxdesign/core/VStack'
import {TextInput} from '@astryxdesign/core/TextInput'
import {Button} from '@astryxdesign/core/Button'
import { useEffect, useState } from 'react'
import { api } from '../api'

export function MarkdownPanel() {
  const confirm = useConfirm()
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
  const labels: Record<string, string> = { imported: '导入', exported: '导出', unchanged: '一致', conflict: '冲突', skipped: '跳过', error: '失败', restore: '跨库恢复' }
  const summary = (items: { status: string }[]) => items.reduce<Record<string, number>>((out, x) => { out[x.status] = (out[x.status] || 0) + 1; return out }, {})
  return <section className="panel knowledge-controls"><Heading level={2}>Markdown 与 Obsidian 互通</Heading><p>选择后端机器上的 Markdown 目录。可批量导入，或导出文章、阅读笔记、高亮批注、独立个人笔记、主题页和研究成果；个人笔记标签、稳定 ID 与研究证据快照随文件保留。</p><VStack><TextInput label="目录路径" width="100%" value={directory} onChange={(_value, e) => { setDirectory(e.target.value); setData(null) }} /></VStack><VStack><CheckboxInput label="每两分钟同步无冲突修改（冲突和外部删除不会自动覆盖本地资料）"  value={automatic} onChange={(_checked, e) => setAutomatic(e.target.checked)} /></VStack>
    <HStack gap={3} wrap="wrap" vAlign="center" className="knowledge-actions"><Button label="保存目录配置" variant="secondary"  isDisabled={busy || !directory.trim()} onClick={() => void run(async () => { await api.configureMarkdown(directory, automatic); await refresh(); setMessage('目录配置已保存') })}>保存目录配置</Button><Button label="扫描外部变化" variant="secondary"  isDisabled={busy} onClick={() => void run(refresh)}>扫描外部变化</Button><Button label="导出全部资料" variant="primary"  isDisabled={busy} onClick={() => void run(async () => { const d = await api.exportMarkdown(); setMessage(Object.entries(summary(d.items)).map(([k, n]) => `${labels[k] || k} ${n} 项`).join('，')); await refresh() })}>导出全部资料</Button></HStack>
    {busy && <p role="status">正在处理文件…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data && <><p>正在扫描：{data.directory}</p><VStack className="markdown-change-table" isScrollable><Table aria-label="Markdown 文件变化" dividers="rows"><TableHeader><TableRow><TableHeaderCell>选择</TableHeaderCell><TableHeaderCell>文件</TableHeaderCell><TableHeaderCell>状态与操作</TableHeaderCell></TableRow></TableHeader><TableBody>{data.items.map((x) => <TableRow key={x.path}><TableCell><CheckboxInput label={`选择文件：${x.path}`} isLabelHidden  value={selected.includes(x.path)} isDisabled={busy || !['new', 'update', 'adopt', 'restore'].includes(x.status)} onChange={() => setSelected(selected.includes(x.path) ? selected.filter((p) => p !== x.path) : [...selected, x.path])} /></TableCell><TableCell>{x.path}</TableCell><TableCell><strong>{({ new: '新文档', update: '外部修改', adopt: '需要确认接管', conflict: '冲突，保留双方', export: '本地修改待导出', unchanged: '一致', missing: '外部已删除，本地保留', error: '无法读取', foreign: '其他资料库', restore: '可恢复个人笔记（新建本地 ID）' } as Record<string, string>)[x.status] || x.status}</strong>{x.message && <small>{x.message}</small>}{x.status === 'conflict' && x.record_hash && x.file_hash && <Button label="已人工合并，备份双方后导入" variant="secondary" type="button"  isDisabled={busy} onClick={async () => { if ((await confirm('请先在外部文件中完成合并。继续会备份双方正文，再将外部版本写入本地；历史笔记版本保留。'))) void run(async () => { const d = await api.importMarkdownFiles([x.path], { [x.path]: x.file_hash! }, { [x.path]: x.record_hash! }); setMessage(Object.entries(summary(d.items)).map(([k, n]) => `${labels[k] || k} ${n} 项`).join('，')); await refresh() }) }}>已人工合并，备份双方后导入</Button>}</TableCell></TableRow>)}</TableBody></Table></VStack><Button label={`导入所选变化（${selected.length}）`} variant="primary"  isDisabled={busy || !selected.length} onClick={() => void run(async () => { const restores = data.items.filter((x) => selected.includes(x.path) && x.status === 'restore'); if (restores.length && !(await confirm(`确认恢复 ${restores.length} 篇外部资料库的个人笔记？将生成全新的本地 ID，保留原有来源快照，不覆盖当前资料。`))) return; const d = await api.importMarkdownFiles(selected, Object.fromEntries(data.items.filter((x) => x.file_hash).map((x) => [x.path, x.file_hash!]))); setMessage(Object.entries(summary(d.items)).map(([k, n]) => `${labels[k] || k} ${n} 项`).join('，')); await refresh() })}>导入所选变化（{selected.length}）</Button></>}
    <small>新文档默认作为本地文章导入；已导出的独立个人笔记按稳定 ID 回写正文、标题和标签，并保留本地来源快照。支持 UTF-8、YAML 标题/作者/来源及本地图片。已有导出文件按 ID 更新。跨库个人笔记恢复需要手动勾选确认，系统会生成新的本地 ID，保留来源快照而不覆盖现有笔记。文件和本地同时修改时请先人工合并；相对路径越界和符号链接会被拒绝。</small>
  </section>
}
