import {useEffect} from 'react'
import {Pagination as AstryxPagination} from '@astryxdesign/core/Pagination'
import {Selector} from '@astryxdesign/core/Selector'
import {HStack} from '@astryxdesign/core/HStack'

export function Pagination({page, total, pageSize, onPageChange, onPageSizeChange}: {
  page: number; total: number; pageSize: number;
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => { if (page > pageCount) onPageChange(pageCount) }, [page, pageCount, onPageChange])
  const sizes = [...new Set([pageSize, 12, 24, 48, 100])].sort((a, b) => a - b)
  if (total <= Math.min(...sizes)) return null
  // Let each page update its size and page index together, preserving URL filters.
  return <HStack gap={4} hAlign="between" vAlign="end" wrap="wrap" paddingBlock={6}>
    <Selector label="每页条数" size="sm" width="fit-content" value={String(pageSize)} options={sizes.map(size => ({value: String(size), label: `${size} 条 / 页`}))} onChange={value => onPageSizeChange(Number(value))} />
    {pageCount > 1 && <AstryxPagination label="列表分页" page={Math.min(page, pageCount)} totalItems={total} pageSize={pageSize} onChange={onPageChange} pageLabel="页码" variant={pageCount > 7 ? 'input' : 'pages'} />}
  </HStack>
}
