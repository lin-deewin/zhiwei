import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'
export type ButtonSize = 'medium' | 'small'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'medium',
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  const classes = [
    'btn',
    variant === 'primary' ? 'primary' : '',
    variant === 'tertiary' ? 'ghost' : '',
    variant === 'danger' ? 'danger' : '',
    size === 'small' ? 'small' : '',
    className,
  ].filter(Boolean).join(' ')

  return <button type={type} className={classes} {...props}>{children}</button>
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  children: ReactNode
}

export function IconButton({ label, className = '', type = 'button', children, ...props }: IconButtonProps) {
  return <button
    type={type}
    className={['icon-btn', className].filter(Boolean).join(' ')}
    aria-label={label}
    title={label}
    {...props}
  >{children}</button>
}
