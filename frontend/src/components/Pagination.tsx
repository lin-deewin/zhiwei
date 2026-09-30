import { useEffect, useState } from 'react'

export function Pagination({ page, total, pageSize, onPageChange, onPageSizeChange }: {
  page: number; total: number; pageSize: number;
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount)
  const [target, setTarget] = useState('')
  useEffect(() => { if (page > pageCount) onPageChange(pageCount) }, [page, pageCount, onPageChange])
  const start = Math.max(1, Math.min(current - 2, pageCount - 4))
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => start + index)
  const jump = () => {
    const next = Number(target)
    if (Number.isInteger(next) && next >= 1 && next <= pageCount) { onPageChange(next); setTarget('') }
  }
  return <nav className="list-pagination" aria-label="列表分页">
    <span className="pagination-total">共 {total} 条</span>
    <label>每页<select aria-label="每页条数" value={pageSize} onChange={(event) => { onPageSizeChange(Number(event.target.value)); onPageChange(1) }}>{[20, 24, 48, 100].map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label>
    <label>页数<select aria-label="选择页码" value={current} onChange={(event) => onPageChange(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} / {pageCount}</option>)}</select></label>
    <button disabled={current <= 1} onClick={() => onPageChange(current - 1)}>上一页</button>
    {start > 1 && <><button onClick={() => onPageChange(1)}>1</button>{start > 2 && <span>…</span>}</>}
    {pages.map((number) => <button key={number} className={number === current ? 'selected' : ''} aria-current={number === current ? 'page' : undefined} onClick={() => onPageChange(number)}>{number}</button>)}
    {pages[pages.length - 1] < pageCount && <>{pages[pages.length - 1] < pageCount - 1 && <span>…</span>}<button onClick={() => onPageChange(pageCount)}>{pageCount}</button></>}
    <button disabled={current >= pageCount} onClick={() => onPageChange(current + 1)}>下一页</button>
    <form onSubmit={(event) => { event.preventDefault(); jump() }}><input aria-label="跳转页码" type="number" min={1} max={pageCount} value={target} onChange={(event) => setTarget(event.target.value)} /><button type="submit" disabled={!target || !Number.isInteger(Number(target)) || Number(target) < 1 || Number(target) > pageCount}>跳转</button></form>
  </nav>
}
