import { useEffect, useState } from 'react'
import { Bookmark, Bot, FolderOpen } from 'lucide-react'
import { api } from '../../api'
import type { AccountStatus } from '../../api'
import type { LibrarySettings } from '../../types'
import { PageHeader } from '../../design-system/PageHeader'
import { Button } from '../../design-system/Button'
import type { Notice } from '../../app/types'

export function SettingsPage({ settings, onSaved, onNotice, onConnect, dark, density, onThemeChange, onDensityChange }: { settings: LibrarySettings | null; onSaved: (settings: LibrarySettings) => void; onNotice: (notice: Notice) => void; onConnect: () => Promise<void>; dark: boolean; density: 'comfortable' | 'compact'; onThemeChange: (dark: boolean) => void; onDensityChange: (density: 'comfortable' | 'compact') => void }) {
  const [path, setPath] = useState(settings?.library_dir || '')
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null)
  const [baseUrl, setBaseUrl] = useState(settings?.ai_base_url || '')
  const [chatModel, setChatModel] = useState(settings?.ai_chat_model || '')
  const [embeddingModel, setEmbeddingModel] = useState(settings?.ai_embedding_model || '')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  useEffect(() => { if (settings?.library_dir) setPath(settings.library_dir) }, [settings?.library_dir])
  useEffect(() => { setBaseUrl(settings?.ai_base_url || ''); setChatModel(settings?.ai_chat_model || ''); setEmbeddingModel(settings?.ai_embedding_model || '') }, [settings?.ai_base_url, settings?.ai_chat_model, settings?.ai_embedding_model])
  useEffect(() => {
    let active = true
    const refreshAccount = () => api.account().then((status) => { if (active) setAccountStatus(status) }).catch((error) => {
      if (active) onNotice({ message: (error as Error).message, error: true })
    })
    refreshAccount()
    const timer = window.setInterval(refreshAccount, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [onNotice])
  const accountConnected = accountStatus?.status === 'connected'
  const accountLabel = accountConnected ? '已连接' : !accountStatus ? '检查中' : accountStatus.status === 'restoring' ? '校验中' : accountStatus.status === 'network_error' ? '暂无法校验' : ['awaiting_login', 'challenge_required'].includes(accountStatus.status) ? '待验证' : accountStatus.status === 'expired' ? '会话失效' : '未连接'
  const save = async () => {
    try { const result = await api.updateSettings(path); const latest = await api.settings(); onSaved({ ...latest, library_dir: result.library_dir }) }
    catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  const saveAI = async () => {
    try {
      await api.updateAISettings({ base_url: baseUrl, chat_model: chatModel, embedding_model: embeddingModel, api_key: apiKey || undefined, clear_api_key: clearApiKey })
      setApiKey('')
      setClearApiKey(false)
      onSaved(await api.settings())
      onNotice({ message: '模型配置已保存。' })
    } catch (e) { onNotice({ message: (e as Error).message, error: true }) }
  }
  return <div className="subpage settings-page"><PageHeader eyebrow="PREFERENCES" title="偏好设置" description="管理你的资料存储、服务连接与隐私设置。" /><div className="settings-stack">
    <section className="panel settings-panel appearance-settings">
      <div className="panel-title"><div><h2>外观与阅读体验</h2><span>这些偏好只保存在当前浏览器，不会影响你的资料库。</span></div><div className="settings-section-icon"><FolderOpen size={18} /></div></div>
      <div className="setting-row"><div><strong>界面主题</strong><small>在浅色与深色界面之间切换</small></div><select className="select" aria-label="界面主题" value={dark ? 'dark' : 'light'} onChange={(event) => onThemeChange(event.target.value === 'dark')}><option value="light">浅色模式</option><option value="dark">深色模式</option></select></div>
      <div className="setting-row"><div><strong>内容密度</strong><small>调整文章列表的行距和信息密度</small></div><select className="select" aria-label="内容密度" value={density} onChange={(event) => onDensityChange(event.target.value as 'comfortable' | 'compact')}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></div>
    </section>
    <div className="panel settings-panel"><div className="panel-title"><div><h2>本地资料目录</h2><span>文章与数据库保存在本机，不会自动上传</span></div><div className="settings-section-icon"><FolderOpen size={18} /></div></div><label className="setting-label">目录路径<input value={path} onChange={(e) => setPath(e.target.value)} placeholder="例如 /home/you/Documents/ZhihuLibrary" /></label><p className="setting-help">路径由本地服务所在的电脑访问。修改目录后会切换到该目录中的资料库，不会自动搬移旧文章。</p><Button variant="primary" onClick={save}>保存目录</Button></div><div className="panel settings-panel"><div className="panel-title"><div><h2>知乎账号</h2><span>在知微页面扫码并完成必要的知乎验证</span></div><div className="settings-section-icon warm"><Bookmark size={18} /></div></div><div className="setting-status-row"><span className={`status-badge ${accountConnected ? 'status-connected' : 'status-muted'}`}><i /> {accountLabel}</span><button className="button button-soft" onClick={onConnect}>{accountConnected ? '查看连接' : '连接知乎'}</button></div>{accountStatus?.message && <p className="setting-help">{accountStatus.message}</p>}</div><div className="panel settings-panel"><div className="panel-title"><div><h2>AI 与知识问答</h2><span>可连接 OpenAI 兼容服务，或使用本机 OpenCode 免费模型</span></div><div className="settings-section-icon lilac"><Bot size={18} /></div></div><div className="ai-settings-grid"><label className="setting-label">API 地址<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="opencode://local 或 https://api.example.com/v1" /></label><label className="setting-label">聊天模型<input value={chatModel} onChange={(e) => setChatModel(e.target.value)} placeholder={baseUrl === 'opencode://local' ? 'opencode/space-bunny-free' : '模型名称'} /></label><label className="setting-label">本地 Embedding 模型<input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} placeholder="留空使用 BAAI/bge-small-zh-v1.5" /></label>{baseUrl !== 'opencode://local' && <label className="setting-label">API Key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings?.ai_api_key_set ? '已保存；留空表示不更改' : '由本地后端保存'} autoComplete="new-password" /></label>}</div>{settings?.ai_api_key_set && <label className="clear-key-option"><input type="checkbox" checked={clearApiKey} onChange={(e) => setClearApiKey(e.target.checked)} /> 清除本机已保存的 API Key</label>}<p className="setting-help">提交知识库问题时会发送检索片段；你点击智能分类时会发送当前文章内容片段。{baseUrl === 'opencode://local' ? '通过本机 OpenCode CLI 调用所选模型；文章片段会发送给模型服务商。' : '密钥保存在本机权限受限的配置文件中。'} 语义向量在本机生成；在知识问答页面建立或更新索引。</p><Button variant="primary" onClick={saveAI}>保存模型配置</Button></div></div></div>
}

