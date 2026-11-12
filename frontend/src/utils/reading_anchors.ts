import type { ReadingContext, TextAnchor } from '../types'

function codePointOffset(node: Node, offset: number): number {
  const root = node.parentElement?.closest<HTMLElement>('[data-reading-block-id]')
  if (!root) return 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let result = 0
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text
    if (textNode === node) return result + Array.from(textNode.data.slice(0, offset)).length
    result += Array.from(textNode.data).length
  }
  return result
}

export function anchorFromSelection(context: ReadingContext): TextAnchor | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const startElement = range.startContainer.parentElement?.closest<HTMLElement>('[data-reading-block-id]')
  const endElement = range.endContainer.parentElement?.closest<HTMLElement>('[data-reading-block-id]')
  if (!startElement || startElement !== endElement || !context.revision_id) return null
  const blockId = startElement.dataset.readingBlockId
  const block = context.blocks.find((item) => item.id === blockId)
  if (!block?.markable) return null
  const start = codePointOffset(range.startContainer, range.startOffset)
  const end = codePointOffset(range.endContainer, range.endOffset)
  const chars = Array.from(block.text)
  if (end <= start || end > chars.length) return null
  const exact = chars.slice(start, end).join('')
  if (exact !== range.toString()) return null
  return {
    revision_id: context.revision_id,
    normalization_version: context.normalization_version,
    block_id: block.id,
    start,
    end,
    exact,
    prefix: chars.slice(Math.max(0, start - 32), start).join(''),
    suffix: chars.slice(end, end + 32).join(''),
    block_hash: block.text_hash,
    heading_path: block.heading_path,
  }
}

export function rangeForAnchor(anchor: TextAnchor): Range | null {
  const selector = '[data-reading-block-id="' + CSS.escape(anchor.block_id) + '"]'
  const root = document.querySelector<HTMLElement>(selector)
  if (!root) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remainingStart = anchor.start
  let remainingEnd = anchor.end
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const length = Array.from(node.data).length
    if (!startNode && remainingStart <= length) {
      startNode = node
      startOffset = Array.from(node.data).slice(0, remainingStart).join('').length
    }
    if (remainingEnd <= length) {
      endNode = node
      endOffset = Array.from(node.data).slice(0, remainingEnd).join('').length
      break
    }
    remainingStart -= length
    remainingEnd -= length
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}
