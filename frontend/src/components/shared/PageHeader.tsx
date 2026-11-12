import type {ReactNode} from 'react'
import {HStack} from '@astryxdesign/core/HStack'
import {VStack} from '@astryxdesign/core/VStack'
import {Heading} from '@astryxdesign/core/Heading'
import {Text} from '@astryxdesign/core/Text'

export function PageHeader({title, description, actions}: {title: string; description?: string; actions?: ReactNode}) {
  return <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap" paddingBlockEnd={6}>
    <VStack gap={2}><Heading level={1}>{title}</Heading>{description && <Text color="secondary">{description}</Text>}</VStack>
    {actions && <HStack gap={3} wrap="wrap">{actions}</HStack>}
  </HStack>
}
