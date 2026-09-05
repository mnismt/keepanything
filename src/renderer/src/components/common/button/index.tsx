import type { StyleXStyles } from '@stylexjs/stylex'
import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { styles } from './styles'

export type ButtonVariant = 'default' | 'primary' | 'quiet' | 'danger'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style'> {
  variant?: ButtonVariant
  /** Square icon-only button; pass `aria-label`. */
  icon?: boolean
  small?: boolean
  style?: StyleXStyles
  children?: ReactNode
}

/** The one button. Variants stay quiet; `primary` is the only high-contrast control. */
export function Button({
  variant = 'default',
  icon = false,
  small = false,
  style,
  type = 'button',
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      {...stylex.props(
        styles.button,
        variant === 'primary' && styles.primary,
        (variant === 'quiet' || variant === 'danger') && styles.quiet,
        variant === 'danger' && styles.danger,
        icon && styles.icon,
        small && styles.small,
        small && icon && styles.smallIcon,
        style
      )}
      {...rest}
    />
  )
}
