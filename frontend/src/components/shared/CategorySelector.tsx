import {Selector} from '@astryxdesign/core/Selector'
import type {Category} from '../../types'

export function CategorySelector({categories, value, onChange, label = '本地分类'}: {
  categories: Category[]; value: string; onChange: (value: string) => void; label?: string;
}) {
  const options = categories.filter(category => category.parent_id || !categories.some(child => child.parent_id === category.id))
    .map(category => ({value: String(category.id), label: [category.parent_id ? categories.find(parent => parent.id === category.parent_id)?.name : null, category.name].filter(Boolean).join(' / ')}))
  return <Selector label={label} value={value} onChange={onChange} options={[{value: '', label: '待整理'}, ...options]} width="100%" />
}
