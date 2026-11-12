import {Home, Moon, Sun, ArrowDownToLine, BookOpen, Bookmark, Clock3, CircleHelp, FileText, LayoutGrid, Settings2, Sparkles, Tags} from 'lucide-react'
import {useLocation} from 'react-router-dom'
import {SideNav, SideNavHeading, SideNavItem, SideNavSection} from '@astryxdesign/core/SideNav'
import {Button} from '@astryxdesign/core/Button'
import {VStack} from '@astryxdesign/core/VStack'
import {Text} from '@astryxdesign/core/Text'
import type {Category, LibrarySettings} from '../types'

type AppSidebarProps = {
  readingTheme: boolean
  onThemeToggle: () => void
  categories: Category[]
  settings: LibrarySettings | null
  pendingCount: number | null
}

export function AppSidebar({categories, settings, pendingCount, readingTheme, onThemeToggle}: AppSidebarProps) {
  const {pathname, search} = useLocation()
  const selected = (href: string) => pathname === href
  return <SideNav aria-label="主导航" collapsible
    header={<SideNavHeading heading="知微" subheading="个人知识库" headingHref="/" icon={<Bookmark aria-hidden="true" />} />}
    footer={<VStack gap={3} padding={4}>
      <Button label={readingTheme ? '切换到浅色主题' : '切换到护眼主题'} icon={readingTheme ? <Sun /> : <Moon />} variant="ghost" onClick={onThemeToggle} />
      <Text color="secondary" size="sm">本地资料库 · {settings?.content_count ?? '—'} 篇</Text>
      <Text color="secondary" size="sm" maxLines={2}>{settings?.library_dir || '正在读取目录…'}</Text>
    </VStack>}>
    <SideNavSection title="工作空间">
      <SideNavItem label="概览" icon={Home} href="/overview" isSelected={selected('/overview')} />
      <SideNavItem label="资料库" icon={LayoutGrid} href="/" isSelected={selected('/') && !search} />
      <SideNavItem label="话题汇总" icon={CircleHelp} href="/questions" isSelected={pathname.startsWith('/questions')} />
    </SideNavSection>
    <SideNavSection title="阅读与笔记">
      <SideNavItem label="最近阅读" icon={Clock3} href="/reading" isSelected={selected('/reading')} />
      <SideNavItem label="阅读记录" icon={BookOpen} href="/notes" isSelected={selected('/notes')} />
      <SideNavItem label="个人笔记" icon={FileText} href="/personal-notes" isSelected={selected('/personal-notes')} />
      <SideNavItem label="知识工作台" icon={Sparkles} href="/knowledge?tab=assistant" isSelected={selected('/knowledge') || selected('/ask')} />
    </SideNavSection>
    <SideNavSection title="常用分类">
      {categories.filter(item => !item.parent_id).slice(0, 7).map(item => <SideNavItem key={item.id} label={item.name} href={`/?category=${item.id}`} isSelected={selected('/') && new URLSearchParams(search).get('category') === String(item.id)} endContent={String(item.article_count)} />)}
      <SideNavItem label="待整理" href="/?pending=1" endContent={pendingCount === null ? '—' : String(pendingCount)} isSelected={selected('/') && new URLSearchParams(search).get('pending') === '1'} />
    </SideNavSection>
    <SideNavSection title="管理">
      <SideNavItem label="同步中心" icon={ArrowDownToLine} href="/sync" isSelected={selected('/sync')} />
      <SideNavItem label="主题分类" icon={Tags} href="/categories" isSelected={selected('/categories')} />
      <SideNavItem label="设置" icon={Settings2} href="/settings" isSelected={selected('/settings')} />
    </SideNavSection>
  </SideNav>
}
