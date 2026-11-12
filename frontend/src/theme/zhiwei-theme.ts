import {defineTheme} from '@astryxdesign/core/theme'
import {neutralTheme} from '@astryxdesign/theme-neutral/built'

// Brand decisions live here; pages consume semantic tokens only.
export const zhiweiTheme = defineTheme({
  name: 'zhiwei',
  extends: neutralTheme,
  tokens: {
    '--color-accent': ['#3e6652', '#8fc6a8'],
    '--color-on-accent': ['#ffffff', '#142c20'],
    '--color-text-accent': ['#365e49', '#a6d8bc'],
    '--color-icon-accent': ['#365e49', '#a6d8bc'],
    '--color-accent-muted': ['#e8f1eb', '#293f33'],
    '--color-background-body': ['#f5f6f7', '#242526'],
    '--color-background-surface': ['#ffffff', '#303132'],
    '--color-background-card': ['#ffffff', '#303132'],
    '--color-background-popover': ['#ffffff', '#303132'],
    '--color-text-primary': ['#282d31', '#f4f4f2'],
    '--color-text-secondary': ['#626c66', '#c5cbc6'],
    '--font-family-body': '\"PingFang SC\", \"Noto Sans SC\", system-ui, sans-serif',
    '--font-family-heading': '\"PingFang SC\", \"Noto Sans SC\", system-ui, sans-serif',
  },
})
