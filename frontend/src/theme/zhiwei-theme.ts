import {defineTheme} from '@astryxdesign/core/theme'
import {neutralTheme} from '@astryxdesign/theme-neutral/built'

// Brand decisions live here; pages consume semantic tokens only.
export const zhiweiTheme = defineTheme({
  name: 'zhiwei',
  extends: neutralTheme,
  typography: { scale: { base: 16, ratio: 1.2 } },
  components: {
    'side-nav-item': { base: { minHeight: 'var(--spacing-10)', fontSize: 'var(--text-supporting-size)' }, selected: { backgroundColor: 'var(--color-accent-muted)', color: 'var(--color-text-accent)' } },
    'side-nav-heading': { base: { paddingBlock: 'var(--spacing-5)' } },
    button: { base: { fontWeight: '500' } },
  },
  tokens: {
    '--color-accent': ['#3e6652', '#8fc6a8'],
    '--color-on-accent': ['#ffffff', '#142c20'],
    '--color-text-accent': ['#365e49', '#a6d8bc'],
    '--color-icon-accent': ['#365e49', '#a6d8bc'],
    '--color-accent-muted': ['#e8f1eb', '#293f33'],
    '--color-background-body': ['#f6f7f5', '#1d2220'],
    '--color-background-surface': ['#ffffff', '#262d29'],
    '--color-background-card': ['#ffffff', '#262d29'],
    '--color-background-popover': ['#ffffff', '#262d29'],
    '--color-text-primary': ['#282d31', '#f4f4f2'],
    '--color-text-secondary': ['#66716b', '#b4c0b8'],
    '--size-element-sm': '2rem',
    '--size-element-md': '2.5rem',
    '--size-element-lg': '3rem',
    '--text-supporting-size': '0.875rem',
    '--text-body-leading': '1.65',
    '--text-heading-1-size': '1.75rem',
    '--text-heading-2-size': '1.25rem',
    '--text-heading-3-size': '1.125rem',
    '--color-border': ['#e2e7e2', '#3a453e'],
    '--color-background-muted': ['#f0f3ef', '#303a33'],
    '--font-family-body': '"PingFang SC", "Noto Sans SC", system-ui, sans-serif',
    '--font-family-heading': '"PingFang SC", "Noto Sans SC", system-ui, sans-serif',
  },
})
