import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { splitMinutes } from '../lib/time'

/** Buttons, chips and cards of the Figma components page - the tokens live in index.css. */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  const look =
    variant === 'primary'
      ? 'bg-primary text-on-primary hover:bg-primary-strong disabled:bg-primary/45'
      : 'border-2 border-primary bg-surface text-primary hover:bg-primary-soft disabled:opacity-50'
  return (
    <button
      type="button"
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 font-bold transition-colors
        disabled:cursor-not-allowed ${look} ${className}`}
      {...rest}
    />
  )
}

export function LinkButton({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full border-2 border-primary bg-surface px-6
        font-bold text-primary transition-colors hover:bg-primary-soft ${className}`}
    >
      {children}
    </a>
  )
}

type ChipTone = 'neutral' | 'primary' | 'accent'
const CHIP: Record<ChipTone, string> = {
  neutral: 'bg-surface-alt text-ink',
  primary: 'bg-primary-soft text-primary-strong',
  accent: 'bg-accent text-ink',
}

export function Chip({
  tone = 'neutral',
  children,
  className = '',
  title,
}: {
  tone?: ChipTone
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] leading-[18px] font-medium whitespace-nowrap ${CHIP[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function Card({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'li' | 'article' }) {
  return <Tag className={`rounded-lg border-2 border-line bg-surface ${className}`}>{children}</Tag>
}

/** "35 хв", "2 год", "1 год 30 хв". */
export function useDuration() {
  const { t } = useTranslation()
  return (minutes: number) => {
    const { h, m } = splitMinutes(minutes)
    if (h === 0) return t('unit.minutes', { m })
    if (m === 0) return t('unit.hours', { h })
    return t('unit.hoursMinutes', { h, m })
  }
}

/** Numbers in the Ukrainian way: 62,8. */
export const formatScore = (n: number) => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)
export const formatInt = (n: number) => new Intl.NumberFormat('uk-UA').format(n)

/** The page title of a screen, with an optional back link above it. */
export function ScreenTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="space-y-1">
      <h1 className="text-[22px] leading-7 font-semibold lg:text-[28px] lg:leading-[34px] lg:font-bold">{children}</h1>
      {sub && <p className="text-[13px] leading-[18px] font-medium text-ink-muted">{sub}</p>}
    </header>
  )
}

export function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded px-1 text-[13px] font-semibold text-primary hover:underline">
      <span aria-hidden>←</span>
      {children}
    </button>
  )
}
