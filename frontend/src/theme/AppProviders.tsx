import {forwardRef, type ComponentProps, type ReactNode} from 'react'
import {Link as RouterLink} from 'react-router-dom'
import {Theme} from '@astryxdesign/core/theme'
import {LinkProvider} from '@astryxdesign/core/Link'
import {InternationalizationProvider} from '@astryxdesign/core/i18n'
import {zhiweiTheme} from './zhiwei'
import './zhiwei.css'

const NavigationLink = forwardRef<HTMLAnchorElement, ComponentProps<'a'>>(
  function NavigationLink({href = '/', ...props}, ref) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return <a ref={ref} href={href} {...props} />
    return <RouterLink ref={ref} to={href} {...props} />
  },
)
export function AppProviders({dark, children}: {dark: boolean; children: ReactNode}) {
  return <Theme theme={zhiweiTheme} mode={dark ? 'dark' : 'light'}>
    <InternationalizationProvider locale="zh-Hans">
      <LinkProvider component={NavigationLink}>{children}</LinkProvider>
    </InternationalizationProvider>
  </Theme>
}
