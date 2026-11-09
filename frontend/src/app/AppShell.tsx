import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Layers, Menu, Moon, MoreHorizontal, Search, Sun, type LucideIcon } from 'lucide-react'
import { IconButton } from '../design-system/Button'

export type AppNavItem = {
  href: string
  title: string
  icon: LucideIcon
}
export type AppNavGroup = {
  heading: string
  items: AppNavItem[]
}

type AppShellProps = {
  children: ReactNode
  navGroups: AppNavGroup[]
  pageTitle: string
  contentCount: number | string
  libraryPath: string
  isReady: boolean
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
  onOpenSearch: () => void
  dark: boolean
  onToggleTheme: () => void
}

export function AppShell({
  children,
  navGroups,
  pageTitle,
  contentCount,
  libraryPath,
  isReady,
  mobileOpen,
  onMobileOpenChange,
  onOpenSearch,
  dark,
  onToggleTheme,
}: AppShellProps) {
  return <div className="app zv-app">
    <button
      className={'sidebar-scrim' + (mobileOpen ? ' open' : '')}
      type="button"
      aria-label="关闭侧边菜单"
      onClick={() => onMobileOpenChange(false)}
    />
    <aside className={'sidebar' + (mobileOpen ? ' open' : '')} aria-label="主导航">
      <Link className="brand" to="/" onClick={() => onMobileOpenChange(false)}>
        <span className="brand-logo"><Layers size={20} /></span>
        <span className="brand-word">知微<small>Knowledge, thoughtfully.</small></span>
      </Link>

      <nav className="sidebar-content" aria-label="知识工作台导航">
        {navGroups.map((group, groupIndex) => <div className="nav-section" key={group.heading || 'tools-' + groupIndex}>
          {group.heading
            ? <div className="nav-heading">{group.heading}</div>
            : <div className="nav-separator" />}
          {group.items.map((item) => {
            const Icon = item.icon
            return <NavLink
              key={item.href}
              to={item.href}
              end={item.href === '/' || item.href === '/library'}
              onClick={() => onMobileOpenChange(false)}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{item.title}</span>
              {item.href === '/library' && <em>{contentCount}</em>}
            </NavLink>
          })}
        </div>)}
      </nav>

      <div className="sidebar-foot">
        <Link to="/settings" className="account-row" onClick={() => onMobileOpenChange(false)}>
          <span className="account-avatar">知</span>
          <span className="account-copy">
            <b>我的知识空间</b>
            <small title={libraryPath}>{libraryPath}</small>
          </span>
          <MoreHorizontal size={17} />
        </Link>
      </div>
    </aside>

    <div className="main main-area">
      <header className="topbar">
        <div className="crumbs">
          <IconButton className="mobile-menu" label="打开菜单" onClick={() => onMobileOpenChange(true)}>
            <Menu size={20} />
          </IconButton>
          <span>个人空间</span>
          <span className="slash">/</span>
          <strong>{pageTitle}</strong>
        </div>
        <div className="top-actions">
          <button className="global-search-button" type="button" onClick={onOpenSearch} aria-label="全局搜索">
            <Search size={15} />
            <span>搜索任何内容...</span>
            <kbd>⌘ K</kbd>
          </button>
          <span className="status-line" aria-live="polite">
            <i className="status-dot" />
            {isReady ? '本地就绪' : '正在连接'}
          </span>
          <IconButton label={dark ? '切换为浅色模式' : '切换为深色模式'} onClick={onToggleTheme}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </IconButton>
        </div>
      </header>

      <main className="workspace">{children}</main>
    </div>
  </div>
}
