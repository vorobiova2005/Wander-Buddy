import { useTranslation } from 'react-i18next'
import { WANDER_ART, type WanderMood } from './wanderArt'

export type { WanderMood }

type Props = {
  mood: WanderMood
  /** Height in px; the width follows the 200 × 260 drawing. */
  size?: number
  /** A gentle bob - off for people who asked the system for less motion (index.css). */
  animated?: boolean
  className?: string
}

/** Вандер in one of his 11 moods. The art is our own constant markup (wanderArt.ts), never user data. */
export function Wander({ mood, size = 120, animated = true, className = '' }: Props) {
  const { t } = useTranslation()
  return (
    <svg
      role="img"
      aria-label={t(`wander.alt.${mood}`)}
      data-mood={mood}
      viewBox="0 0 200 260"
      width={(size * 200) / 260}
      height={size}
      fill="none"
      className={`shrink-0 overflow-visible ${animated ? 'motion-safe:animate-bob' : ''} ${className}`}
      dangerouslySetInnerHTML={{ __html: WANDER_ART[mood] }}
    />
  )
}

/** Вандер with a speech bubble, as in the "Репліка Вандера" component. */
export function WanderSays({
  mood,
  line,
  size = 120,
  artClassName = '',
}: {
  mood: WanderMood
  line: string
  size?: number
  /** Responsive size classes for the drawing (they win over `size`). */
  artClassName?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <Wander mood={mood} size={size} className={artClassName} />
      <p
        key={line}
        className="relative max-w-sm flex-1 rounded-md border-2 border-ink bg-surface px-4 py-3 motion-safe:animate-fade
          before:absolute before:top-1/2 before:-left-[9px] before:size-4 before:-translate-y-1/2 before:rotate-45
          before:border-b-2 before:border-l-2 before:border-ink before:bg-surface before:content-['']"
      >
        {line}
      </p>
    </div>
  )
}
