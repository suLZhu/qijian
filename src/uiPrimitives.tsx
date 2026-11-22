import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './uiPrimitives.css'
import { IconBack, IconClose, IconChevronRight, type IconComponent } from './icons'

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  icon: IconComponent
  label: string
  iconSize?: number | string
  children?: ReactNode
  touch?: boolean
}

export function IconButton({
  icon: Icon,
  label,
  iconSize = 'var(--ui-icon-assist)',
  touch = false,
  className = '',
  title,
  type = 'button',
  children,
  ...buttonProps
}: IconButtonProps) {
  return (
    <button type={type} className={[touch && 'ui-touch-control', className].filter(Boolean).join(' ')} aria-label={label} title={title || label} {...buttonProps}>
      <Icon size={iconSize} />
      {children}
    </button>
  )
}

type NavigationButtonProps = Omit<IconButtonProps, 'icon' | 'iconSize' | 'touch'>

export function BackButton({ className, ...props }: NavigationButtonProps) {
  return <IconButton {...props} className={['ui-back-button', className].filter(Boolean).join(' ')}
    icon={IconBack} iconSize="var(--ui-icon-action)" touch />
}

export function CloseButton(props: NavigationButtonProps) {
  return <IconButton {...props} icon={IconClose} iconSize="var(--ui-icon-action)" touch />
}

type SettingsRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon?: IconComponent
  title: string
  detail?: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  iconSize?: number | string
}

export function SettingsRow({
  icon: Icon,
  title,
  detail,
  meta,
  trailing,
  iconSize = 'var(--ui-icon-chevron)',
  type = 'button',
  className = '',
  ...buttonProps
}: SettingsRowProps) {
  return (
    <button type={type} className={['settings-row', 'ui-touch-control', className].filter(Boolean).join(' ')} {...buttonProps}>
      {Icon ? <span className="settings-row-icon"><Icon size={iconSize} /></span> : null}
      <span className="settings-row-text">
        <b>{title}</b>
        {detail ? <small>{detail}</small> : null}
      </span>
      {meta ? <span className="settings-row-meta">{meta}</span> : null}
      {trailing ?? <span className="settings-row-chev" aria-hidden="true"><IconChevronRight size="var(--ui-icon-chevron)" /></span>}
    </button>
  )
}
