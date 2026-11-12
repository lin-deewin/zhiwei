import {useEffect} from 'react'
import {Pagination as AstryxPagination} from '@astryxdesign/core/Pagination'
import {VStack} from '@astryxdesign/core/VStack'

export function Pagination({page, total, pageSize, onPageChange, onPageSizeChange}: {
  page: number; total: number; pageSize: number;
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => { if (page > pageCount) onPageChange(pageCount) }, [page, pageCount, onPageChange])
  const sizes = [...new Set([pageSize, 12, 20, 24, 48, 100])].sort((a, b) => a - b)
  return <VStack gap={3} paddingBlock={6}>
    <AstryxPagination label="列表分页" page={Math.min(page, pageCount)} totalItems={total} pageSize={pageSize}
      pageSizeOptions={sizes} onPageSizeChange={onPageSizeChange} onChange={onPageChange} variant="pages" />
    {pageCount > 5 && <AstryxPagination label="跳转页码" pageLabel="页码" page={Math.min(page, pageCount)} totalItems={total} pageSize={pageSize} onChange={onPageChange} variant="input" />}
  </VStack>
}
