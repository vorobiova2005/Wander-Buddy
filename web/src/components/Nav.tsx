import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatInt } from './ui'

export type Tab = 'search' | 'map' | 'progress'

/** Icons of the "Нижнє меню" component, 24 px, stroke = currentColor. */
const ICONS: Record<Tab, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  map: (
    <>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  progress: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" />
    </>
  ),
}

function Icon({ tab }: { tab: Tab }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[tab]}
    </svg>
  )
}

type NavProps = { active: Tab; onSelect: (tab: Tab) => void }
const TABS: Tab[] = ['search', 'map', 'progress']

/** Phones and tablets: the bottom bar, above the system's home indicator. */
export function BottomNav({ active, onSelect }: NavProps) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('nav.label')}
      className="fixed inset-x-0 bottom-0 z-[1000] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-[640px] justify-around">
        {TABS.map((tab) => (
          <li key={tab}>
            <button
              type="button"
              onClick={() => onSelect(tab)}
              aria-current={active === tab ? 'page' : undefined}
              className={`flex min-h-16 min-w-20 flex-col items-center justify-center gap-0.5 text-[13px] leading-[18px] font-medium
                ${active === tab ? 'text-primary' : 'text-ink-muted hover:text-ink'}`}
            >
              <Icon tab={tab} />
              {t(`nav.${tab}`)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** From 1024 px: the "Верхнє меню (desktop)" component - logo, tabs, the player's level. */
export function TopNav({ active, onSelect, level, xp }: NavProps & { level: number; xp: number }) {
  const { t } = useTranslation()
  return (
    <header className="sticky top-0 z-[1000] hidden border-b border-line bg-surface/95 backdrop-blur lg:block">
      <div className="mx-auto flex h-[72px] max-w-[1344px] items-center justify-between px-12">
        <button type="button" onClick={() => onSelect('search')} className="font-display text-[22px] leading-7 font-semibold text-primary">
          {t('app.title')}
        </button>
        <nav aria-label={t('nav.label')}>
          <ul className="flex gap-2">
            {TABS.map((tab) => (
              <li key={tab}>
                <button
                  type="button"
                  onClick={() => onSelect(tab)}
                  aria-current={active === tab ? 'page' : undefined}
                  className={`flex min-h-11 items-center gap-2 rounded-full px-4 font-bold transition-colors
                    ${active === tab ? 'bg-primary-soft text-primary-strong' : 'text-ink-muted hover:bg-surface-alt hover:text-ink'}`}
                >
                  <Icon tab={tab} />
                  {t(`nav.${tab}`)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          onClick={() => onSelect('progress')}
          className="min-h-11 rounded-full bg-primary-soft px-3.5 font-bold text-primary-strong"
        >
          {t('nav.levelXp', { level, xp: formatInt(xp) })}
        </button>
      </div>
    </header>
  )
}
