export function formatDate(value: string) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

// Imported summaries often start with the article title already shown above them.
export function articleExcerpt(title: string, excerpt?: string | null): string {
  const text = excerpt?.trim() || ''
  return text.startsWith(title.trim()) && title.trim()
    ? text.slice(title.trim().length).replace(/^[\s：:。！？!?·—-]+/, '')
    : text
}
