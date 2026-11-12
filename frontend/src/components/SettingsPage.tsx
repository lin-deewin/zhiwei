import {CheckboxInput} from '@astryxdesign/core/CheckboxInput'
import {Card} from '@astryxdesign/core/Card'
import {Heading} from '@astryxdesign/core/Heading'
import {HStack} from '@astryxdesign/core/HStack'
import {VStack} from '@astryxdesign/core/VStack'
import {TextInput} from '@astryxdesign/core/TextInput'
import {Button} from '@astryxdesign/core/Button'
import { useEffect, useState } from 'react'
import { Bookmark, Bot, FolderOpen } from 'lucide-react'
import { api, type AccountStatus } from '../api'
import type { LibrarySettings } from '../types'
import type { Notice } from '../types/ui'

type SettingsPageProps = {
  settings: LibrarySettings | null
  onSaved: (settings: LibrarySettings) => void
  onNotice: (notice: Notice) => void
  onConnect: () => Promise<void>
}

export function SettingsPage({ settings, onSaved, onNotice, onConnect }: SettingsPageProps) {
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
  return <div className="subpage"><HStack gap={4} hAlign="between" vAlign="center" wrap="wrap" paddingBlockEnd={6} className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> PREFERENCES</div><Heading level={1}>设置</Heading><p>管理你的资料存储和连接状态。</p></div></HStack><VStack gap={3} className="settings-stack"><Card padding={6} className="panel settings-panel"><div className="panel-title"><div><Heading level={2}>本地资料目录</Heading><span>文章与数据库保存在本机，不会自动上传</span></div><div className="settings-section-icon"><FolderOpen size={18} /></div></div><VStack className="setting-label"><TextInput label="目录路径" width="100%" value={path} onChange={(_value, e) => setPath(e.target.value)} placeholder="例如 /home/you/Documents/ZhihuLibrary" /></VStack><p className="setting-help">路径由本地服务所在的电脑访问。修改目录后会切换到该目录中的资料库，不会自动搬移旧文章。</p><Button label="保存目录" variant="primary"  onClick={save}>保存目录</Button></Card><Card padding={6} className="panel settings-panel"><div className="panel-title"><div><Heading level={2}>知乎账号</Heading><span>在知微页面扫码并完成必要的知乎验证</span></div><div className="settings-section-icon warm"><Bookmark size={18} /></div></div><div className="setting-status-row"><span className={`status-badge ${accountConnected ? 'status-connected' : 'status-muted'}`}><i /> {accountLabel}</span><Button label={accountConnected ? '查看连接' : '连接知乎'} variant="secondary"  onClick={onConnect}>{accountConnected ? '查看连接' : '连接知乎'}</Button></div>{accountStatus?.message && <p className="setting-help">{accountStatus.message}</p>}</Card><Card padding={6} className="panel settings-panel"><div className="panel-title"><div><Heading level={2}>AI 与知识问答</Heading><span>可连接 OpenAI 兼容服务，或使用本机 OpenCode 免费模型</span></div><div className="settings-section-icon lilac"><Bot size={18} /></div></div><div className="ai-settings-grid"><VStack className="setting-label"><TextInput label="API 地址" width="100%" value={baseUrl} onChange={(_value, e) => setBaseUrl(e.target.value)} placeholder="opencode://local 或 https://api.example.com/v1" /></VStack><VStack className="setting-label"><TextInput label="聊天模型" width="100%" value={chatModel} onChange={(_value, e) => setChatModel(e.target.value)} placeholder={baseUrl === 'opencode://local' ? 'opencode/space-bunny-free' : '模型名称'} /></VStack><VStack className="setting-label"><TextInput label="本地 Embedding 模型" width="100%" value={embeddingModel} onChange={(_value, e) => setEmbeddingModel(e.target.value)} placeholder="留空使用 BAAI/bge-small-zh-v1.5" /></VStack>{baseUrl !== 'opencode://local' && <VStack className="setting-label"><TextInput label="API Key" width="100%" type="password" value={apiKey} onChange={(_value, e) => setApiKey(e.target.value)} placeholder={settings?.ai_api_key_set ? '已保存；留空表示不更改' : '由本地后端保存'} autoComplete="new-password" /></VStack>}</div>{settings?.ai_api_key_set && <VStack className="clear-key-option"><CheckboxInput label="清除本机已保存的 API Key"  value={clearApiKey} onChange={(_checked, e) => setClearApiKey(e.target.checked)} /> </VStack>}<p className="setting-help">提交知识库问题时会发送检索片段；你点击智能分类时会发送当前文章内容片段。{baseUrl === 'opencode://local' ? '通过本机 OpenCode CLI 调用所选模型；文章片段会发送给模型服务商。' : '密钥保存在本机权限受限的配置文件中。'} 语义向量在本机生成；在知识问答页面建立或更新索引。</p><Button label="保存模型配置" variant="primary"  onClick={saveAI}>保存模型配置</Button></Card></VStack></div>
}
