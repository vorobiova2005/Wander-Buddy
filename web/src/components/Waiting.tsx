import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WanderSays } from './Wander'

/** Вандер waiting, with a new funny line every few seconds - the first search can take half a minute. */
export function WaitingWander({ size = 120 }: { size?: number }) {
  const { t } = useTranslation()
  const lines = t('wander.lines.waiting', { returnObjects: true }) as string[]
  const [i, setI] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setI((n) => n + 1), 3200)
    return () => clearInterval(timer)
  }, [])
  return <WanderSays mood="waiting" line={lines[i % lines.length]} size={size} />
}

/** Grey placeholders in the shape of the city cards. */
export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul aria-hidden className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-lg border-2 border-line bg-surface p-4">
          <span className="size-9 rounded-full bg-surface-alt motion-safe:animate-pulse" />
          <span className="flex-1 space-y-2">
            <span className="block h-4 w-2/5 rounded bg-surface-alt motion-safe:animate-pulse" />
            <span className="block h-3 w-3/4 rounded bg-surface-alt motion-safe:animate-pulse" />
          </span>
          <span className="h-7 w-12 rounded bg-surface-alt motion-safe:animate-pulse" />
        </li>
      ))}
    </ul>
  )
}
