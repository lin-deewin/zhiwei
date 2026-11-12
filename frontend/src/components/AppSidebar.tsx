import { ArrowDownToLine, BookOpen, Bookmark, Clock3, CircleHelp, FileText, FolderOpen, LayoutGrid, MoreHorizontal, Plus, Settings2, Sparkles } from 'lucide-react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { Category, LibrarySettings } from '../types'

type AppSidebarProps = {
  categories: Category[]
  settings: LibrarySettings | null
  pendingCount: number | null
}

function shortenPath(path: string) {
  const home = path.replace(/^\/home\/[^/]+/, '~')
  return home.length > 28 ? `…${home.slice(-26)}` : home
}

export function AppSidebar({ categories, settings, pendingCount }: AppSidebarProps) {
  const navigate = useNavigate()
  const navClass = ({ isActive }: { isActive: boolean }) => isActive ? 'nav-item active' : 'nav-item'

  return <aside className="sidebar">
    <Link to="/" className="brand">
      <span className="brand-mark"><Bookmark size={19} fill="currentColor" /></span>
      <span><strong>知微</strong><small>个人知识库</small></span>
    </Link>
    <div className="sidebar-scroll">
      <div className="side-caption">核心工作区</div>
      <nav className="primary-nav" aria-label="核心工作区">
        <NavLink to="/" end className={navClass}>
          <LayoutGrid size={17} /> <span>资料库</span><span className="nav-count">{settings?.content_count ?? 0}</span>
        </NavLink>
        <NavLink to="/personal-notes" className={navClass}><FileText size={17} /><span>个人笔记</span></NavLink>
        <NavLink to="/knowledge?tab=assistant" className={navClass}><Sparkles size={17} /><span>AI 工作台</span></NavLink>
      </nav>
      <div className="side-caption">阅读与整理</div>
      <nav className="primary-nav" aria-label="阅读与整理">
        <NavLink to="/reading" className={navClass}><Clock3 size={17} /><span>最近阅读</span></NavLink>
        <NavLink to="/notes" className={navClass}><BookOpen size={17} /><span>阅读记录</span></NavLink>
        <NavLink to="/questions" className={navClass}><CircleHelp size={17} /><span>话题汇总</span></NavLink>
      </nav>
      <div className="side-caption">系统管理</div>
      <nav className="primary-nav" aria-label="系统管理">
        <NavLink to="/sync" title="同步中心" className={navClass}><ArrowDownToLine size={17} /><span>同步中心</span></NavLink>
      </nav>
      <div className="side-caption side-caption-row">
        <span>常用主题</span>
        <button className="icon-button tiny" aria-label="管理主题分类" title="管理主题分类" onClick={() => navigate('/categories')}><Plus size={15} /></button>
      </div>
      <nav className="category-nav" aria-label="常用主题">
        {categories.filter((item) => !item.parent_id).slice(0, 7).map((item, index) => {
          const colors = ['#db8f62', '#6d9e8b', '#8c82bc', '#c39b4e', '#6484aa', '#bd7181', '#728c62']
          return <button key={item.id} className="category-link" onClick={() => navigate(`/?category=${item.id}`)}>
            <span className="category-dot" style={{ background: colors[index % colors.length] }} />
            <span>{item.name}</span><small>{item.article_count}</small>
          </button>
        })}
        {categories.length === 0 && <button className="category-empty" onClick={() => navigate('/categories')}>创建你的第一个主题</button>}
        <button className="category-link" onClick={() => navigate('/?pending=1')}>
          <span className="category-dot" style={{ background: '#a98e79' }} />
          <span>待整理</span><small aria-label={pendingCount === null ? '待整理数量暂不可用' : `${pendingCount} 篇待整理文章`}>{pendingCount ?? '—'}</small>
        </button>
      </nav>
    </div>
    <div className="sidebar-bottom">
      <div className="storage-card">
        <div className="storage-icon"><FolderOpen size={17} /></div>
        <div className="storage-info"><strong>本地资料库</strong><span>{settings?.library_dir ? shortenPath(settings.library_dir) : '正在读取目录…'}</span></div>
        <button className="icon-button tiny" aria-label="设置资料目录" onClick={() => navigate('/settings')}><Settings2 size={15} /></button>
      </div>
      <div className="profile-row"><div className="avatar">知</div><div className="profile-copy"><strong>本地空间</strong><span>离线优先 · 私人使用</span></div><MoreHorizontal size={18} className="muted-icon" /></div>
    </div>
  </aside>
}
