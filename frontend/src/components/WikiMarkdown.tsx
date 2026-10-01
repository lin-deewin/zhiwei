import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { useWikiLinks, wikiPlugin } from '../utils/wiki_markdown'

export function WikiMarkdown({ text }: { text: string }) {
  const links = useWikiLinks(text)
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, [wikiPlugin, { links }]]} rehypePlugins={[rehypeSanitize]}>{text}</ReactMarkdown></div>
}
