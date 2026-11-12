import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine, ArrowRight, Bookmark, Clock3, CircleHelp, FolderOpen,
  Tags, Upload,
} from 'lucide-react'
import { api, type AccountStatus } from '../api'
import type { ClassificationJob, SyncJob, ZhihuFolder } from '../types'
import type { Notice } from '../types/ui'
import { ZhihuLoginDialog } from './ZhihuLoginDialog'

type SyncPageProps = {
  onSync: (mode: 'full' | 'incremental', folderIds: string[]) => Promise<void>
  onImport: (file?: File) => void
  onNotice: (notice: Notice) => void
  onLibraryChanged: () => void
}

export function SyncPage({ onSync, onImport, onNotice, onLibraryChanged }: SyncPageProps) {
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental')
  const [syncActionId, setSyncActionId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<SyncJob[]>([])
  const [classificationJobs, setClassificationJobs] = useState<ClassificationJob[]>([])
  const [classificationPending, setClassificationPending] = useState<number | null>(null)
  const [folders, setFolders] = useState<ZhihuFolder[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[] | null>(null)
  const completedJobRef = useRef('')
  const completedClassificationRef = useRef('')
  const [account, setAccount] = useState<AccountStatus>({ status: 'not_connected', message: '' })
  const [loginOpen, setLoginOpen] = useState(false)
  const refreshAccount = () => api.account().then(setAccount).catch(() => undefined)
  useEffect(() => {
    api.account().then(setAccount).catch(() => undefined)
    const timer = window.setInterval(() => api.account().then(setAccount).catch(() => undefined), 5000)
    return () => window.clearInterval(timer)
  }, [])
  const onLoginConnected = useCallback(() => {
    setLoginOpen(false)
    api.account().then(setAccount).catch(() => undefined)
  }, [])
  useEffect(() => {
    if (account.status === 'connected') {
      api.refreshFolders().then(setFolders).catch((error) => onNotice({ message: error.message, error: true }))
    }
  }, [account.status])
  useEffect(() => {
    let active = true
    const refresh = () => {
      api.syncJobs().then((items) => {
        if (!active) return
        setJobs(items)
        const latest = items[0]
        if (latest && ['completed', 'partial'].includes(latest.status) && completedJobRef.current !== latest.id) {
          completedJobRef.current = latest.id
          onLibraryChanged()
        }
      }).catch(() => undefined)
      api.folders().then((items) => { if (active) setFolders(items) }).catch(() => undefined)
      api.classificationOverview().then((data) => { if (active) setClassificationPending(data.pending) }).catch(() => setClassificationPending(null))
      api.classificationJobs().then((items) => {
        if (!active) return
        setClassificationJobs(items)
        const latest = items[0]
        if (latest && ['completed', 'cancelled', 'failed'].includes(latest.status) && completedClassificationRef.current !== `${latest.id}:${latest.updated_at}`) {
          completedClassificationRef.current = `${latest.id}:${latest.updated_at}`
          onLibraryChanged()
        }
      }).catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [onLibraryChanged])
  const refreshFolders = async () => {
    try { setFolders(await api.refreshFolders()); setSelectedFolderIds(null) }
    catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  const toggleFolder = (id: string) => setSelectedFolderIds((current) => {
    const selected = current ?? folders.map((folder) => folder.id)
    return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
  })
  const activeSyncJob = jobs.find((job) => ['queued', 'running'].includes(job.status))
  const running = Boolean(activeSyncJob)
  const cancelSync = async (job: SyncJob) => {
    if (syncActionId) return
    setSyncActionId(job.id)
    try {
      const updated = await api.cancelSync(job.id)
      onNotice({ message: updated.message || '已请求取消同步；当前正在处理的文章完成后会停止。' })
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    } finally { setSyncActionId(null) }
  }
  const retrySync = async (job: SyncJob) => {
    if (syncActionId) return
    setSyncActionId(job.id)
    try {
      let folderIds: string[] = []
      try {
        const parsed = JSON.parse(job.folder_ids || '[]')
        if (Array.isArray(parsed)) folderIds = parsed.filter((value): value is string => typeof value === 'string')
      } catch { /* Invalid historical scope falls back to all folders. */ }
      await onSync(job.mode, folderIds)
    } catch (error) {
      onNotice({ message: (error as Error).message, error: true })
    } finally { setSyncActionId(null) }
  }
  const classify = async () => { try { await api.startClassification(); onNotice({ message: '主题整理已启动；规则无法确定时会自动调用已配置的大模型。' }) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }
  const classificationRunning = classificationJobs.some((job) => ['queued', 'running'].includes(job.status))
  const latestClassification = classificationJobs[0]
  return <div className="subpage"><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> SYNC CENTER</div><h1>同步中心</h1><p>把知乎收藏安全地保存到你的本地资料库。</p></div><button className="button button-soft" onClick={() => document.getElementById('sync-import')?.click()}><Upload size={16} /> 导入 Markdown</button><input id="sync-import" className="visually-hidden" type="file" accept=".md,.markdown,.txt" onChange={(e) => { onImport(e.target.files?.[0]); e.currentTarget.value = '' }} /></div>
    <div className="sync-account-card"><div className="sync-account-icon"><Bookmark size={21} /></div><div className="sync-account-copy"><strong>{account.profile?.name || (account.status === 'connected' ? '知乎账号已验证' : '知乎账号连接')}</strong><span>{account.message || '用知乎 App 扫码登录。'}</span></div>{account.status === 'connected' ? <><span className="status-badge status-connected"><i /> 已验证</span><button className="button button-soft" onClick={async () => { try { const result = await api.disconnectAccount(); setAccount(result); setFolders([]); setSelectedFolderIds(null); onNotice({ message: result.message }) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }}>退出</button></> : <button className="button button-primary" onClick={() => setLoginOpen(true)}>登录知乎</button>}</div>
    {loginOpen && <ZhihuLoginDialog onClose={() => { setLoginOpen(false); refreshAccount() }} onConnected={onLoginConnected} />}
    <div className="sync-setup-grid"><div className="panel sync-mode-panel"><div className="panel-title"><h2>同步方式</h2><span>选择同步范围</span></div><button onClick={() => setMode('incremental')} className={`sync-mode-option ${mode === 'incremental' ? 'chosen' : ''}`}><span className="radio-dot" /><span><strong>增量同步</strong><small>检查新收藏和可识别的内容变化</small></span><ArrowDownToLine size={17} /></button><button onClick={() => setMode('full')} className={`sync-mode-option ${mode === 'full' ? 'chosen' : ''}`}><span className="radio-dot" /><span><strong>全量同步</strong><small>重新核对已选收藏夹中的全部内容</small></span><Clock3 size={17} /></button><div className="sync-mode-foot"><CircleHelp size={14} />同步后自动依次整理新增文章和话题；远端编辑建议通过全量同步核对。</div><button className="button button-primary sync-start" disabled={account.status !== 'connected' || running || folders.length === 0 || (selectedFolderIds !== null && selectedFolderIds.length === 0)} onClick={() => onSync(mode, selectedFolderIds ?? [])}>开始{mode === 'full' ? '全量' : '增量'}同步 <ArrowRight size={15} /></button></div><div className="panel folder-panel"><div className="panel-title"><h2>同步目标</h2><button className="button button-soft" onClick={refreshFolders} disabled={account.status !== 'connected'}>刷新收藏夹</button></div><div className="folder-placeholder"><div className="folder-placeholder-icon"><FolderOpen size={20} /></div><div><strong>资料保存目录</strong><p>可以在「设置」中输入运行后端的机器上的路径</p></div></div>{folders.length ? <div className="folder-options"><label className="folder-option"><input type="checkbox" checked={selectedFolderIds === null || selectedFolderIds.length === folders.length} onChange={() => setSelectedFolderIds(null)} /><span>全部收藏夹</span></label>{folders.map((folder) => <label className="folder-option" key={folder.id}><input type="checkbox" checked={selectedFolderIds === null || selectedFolderIds.includes(folder.id)} onChange={() => toggleFolder(folder.id)} /><span>{folder.name}</span><small>{folder.article_count} 篇已保存</small></label>)}</div> : <div className="folder-empty"><div className="folder-empty-art"><FolderOpen size={29} /></div><strong>暂无收藏夹</strong><span>连接知乎账号后点击“刷新收藏夹”。</span></div>}</div></div>
    <div className="panel jobs-panel"><div className="panel-title"><h2>最近任务</h2><div className="panel-title-actions"><span>{jobs.length} 条记录</span>{activeSyncJob && <button className="button button-soft" disabled={syncActionId === activeSyncJob.id} onClick={() => void cancelSync(activeSyncJob)}>{syncActionId === activeSyncJob.id ? '正在取消…' : '取消同步'}</button>}</div></div>{jobs.length ? <div className="job-list">{jobs.map((job) => <div className="job-row" key={String(job.id)}><span className="job-icon"><ArrowDownToLine size={16} /></span><div><strong>{job.mode === 'full' ? '全量同步' : '增量同步'}</strong><small>{String(job.status)} · {String(job.updated_at)}</small></div><span>{String(job.message || '')}</span>{['failed', 'interrupted', 'cancelled', 'partial'].includes(job.status) && <button className="button button-soft" disabled={Boolean(syncActionId)} onClick={() => void retrySync(job)}>{syncActionId === job.id ? '正在重试…' : '重新执行'}</button>}{['completed', 'partial'].includes(job.status) && <button className="button button-soft" onClick={classify} disabled={classificationRunning}>自动整理主题</button>}</div>)}</div> : <div className="jobs-empty"><Clock3 size={17} /><span>还没有同步记录</span></div>}</div>
    <div className="panel jobs-panel classification-panel"><div className="panel-title"><h2>主题整理</h2><div className="panel-title-actions"><button className="button button-primary" onClick={classify} disabled={classificationRunning}> {classificationRunning ? '整理中…' : `整理新增文章（${classificationPending ?? 0}）`} </button>{latestClassification && ['queued', 'running'].includes(latestClassification.status) && <button className="button button-soft" onClick={async () => { try { await api.cancelClassification(latestClassification.id) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }}>取消</button>}</div></div>{latestClassification ? <div className="classification-progress"><strong>{latestClassification.status === 'completed' ? '整理完成' : latestClassification.status === 'cancelled' ? '已取消' : latestClassification.status === 'interrupted' ? '等待重试' : '规则与大模型整理主题'}</strong><span>{latestClassification.processed}/{latestClassification.total} 篇 · 已归类 {latestClassification.classified} · 待整理 {latestClassification.pending} · 跳过 {latestClassification.skipped} · 失败 {latestClassification.failed}</span>{latestClassification.error_summary && <small>{latestClassification.error_summary}</small>}{['failed', 'interrupted', 'cancelled'].includes(latestClassification.status) && <button className="button button-soft" onClick={async () => { try { await api.retryClassification(latestClassification.id) } catch (e) { onNotice({ message: (e as Error).message, error: true }) } }}>重试</button>}</div> : <div className="jobs-empty"><Tags size={17} /><span>首次整理已有文章，之后只处理新增文章；规则无法确定时会自动调用已配置的大模型。</span></div>}</div>
  </div>
}
