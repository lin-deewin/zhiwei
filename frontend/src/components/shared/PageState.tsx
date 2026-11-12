import {VStack} from '@astryxdesign/core/VStack'
import {Text} from '@astryxdesign/core/Text'
import {Spinner} from '@astryxdesign/core/Spinner'
import {Banner} from '@astryxdesign/core/Banner'
import {Button} from '@astryxdesign/core/Button'

export function PageState({loading, error, onRetry}: {loading?: boolean; error?: string; onRetry?: () => void}) {
  if (error) return <Banner status="error" title="暂时无法加载" description={error} endContent={onRetry && <Button label="重试" onClick={onRetry} />} role="alert" />
  if (loading) return <VStack padding={8} gap={3} hAlign="center" role="status"><Spinner /><Text color="secondary">正在加载…</Text></VStack>
  return null
}
