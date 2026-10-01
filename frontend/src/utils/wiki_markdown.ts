import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { nodePath, type KnowledgeNode } from './knowledge_links'

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }
export function wikiPlugin(options: { links: Record<string, string> }) {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!node.children || ['link', 'code', 'inlineCode', 'image'].includes(node.type)) return
      const children: MarkdownNode[] = []
      for (const child of node.children) {
        if (child.type !== 'text' || !child.value) { visit(child); children.push(child); continue }
        let start = 0
        for (const match of child.value.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          const [target, alias] = match[1].split('|')
          const url = options.links[target.trim()]
          if (typeof url !== 'string') continue
          children.push({ type: 'text', value: child.value.slice(start, match.index) })
          children.push({ type: 'link', url, children: [{ type: 'text', value: alias || target }] })
          start = (match.index || 0) + match[0].length
        }
        children.push({ type: 'text', value: child.value.slice(start) })
      }
      node.children = children
    }
    visit(tree)
  }
}

export function useWikiLinks(text: string) {
  const targets = useMemo(() => [...new Set([...text.replace(/```[\s\S]*?```|`[^`]*`/g, '').matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => m[1].split('|')[0].trim()))].slice(0, 100), [text])
  const key = targets.join('\u0000')
  const [nodes, setNodes] = useState<Record<string, KnowledgeNode>>({})
  useEffect(() => { let active = true; if (!key) { setNodes({}); return } const timer = window.setTimeout(() => { api.resolveWikiLinks(key.split('\u0000')).then((d) => { if (active) setNodes(d.items) }).catch(() => { if (active) setNodes({}) }) }, 250); return () => { active = false; window.clearTimeout(timer) } }, [key])
  return useMemo(() => Object.fromEntries(targets.filter((t) => Object.prototype.hasOwnProperty.call(nodes, t)).map((t) => [t, nodePath(nodes[t])])), [targets, nodes])
}
