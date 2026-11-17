import { lazy, Suspense, type ComponentProps } from 'react'

/**
 * The map with Leaflet comes in its own chunk, loaded when a screen with a map opens: the search screen - the
 * first one people see - stays light. Meanwhile a calm placeholder of the same size.
 */
const Map = lazy(() => import('./TripMap').then((m) => ({ default: m.TripMap })))

type Props = ComponentProps<typeof import('./TripMap').TripMap>

export function TripMap(props: Props) {
  return (
    <Suspense fallback={<div aria-hidden className={`rounded-lg border-2 border-line bg-primary-soft ${props.className ?? ''}`} />}>
      <Map {...props} />
    </Suspense>
  )
}
