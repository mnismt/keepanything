import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { Icon, type IconName } from '../icon'
import { styles } from './styles'

type Props = { href: string; children: ReactNode; kind?: 'primary' | 'quiet'; icon?: IconName }

export function Button({ href, children, kind = 'quiet', icon }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...stylex.props(styles.root, kind === 'primary' && styles.primary)}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </a>
  )
}
