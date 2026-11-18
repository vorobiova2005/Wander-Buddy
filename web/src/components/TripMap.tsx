import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'

/**
 * Leaflet + OpenStreetMap. Pins are drawn with the design tokens (index.css .wb-pin): the origin dark, the top
 * towns orange with their rank, other candidates white with a number, the rest small dots; quest steps numbered,
 * green when done.
 */
export type MapPoint = {
  id: string
  lat: number
  lon: number
  label: string
  kind: 'origin' | 'top' | 'candidate' | 'dot' | 'step' | 'done'
  number?: number
  onSelect?: () => void
}

const SIZE: Record<MapPoint['kind'], number> = { origin: 18, top: 26, candidate: 24, dot: 12, step: 26, done: 26 }

function icon(p: MapPoint, active: boolean) {
  const size = SIZE[p.kind]
  const cls = { origin: 'wb-pin--origin', top: 'wb-pin--top', candidate: '', dot: 'wb-pin--dot', step: '', done: 'wb-pin--done' }[p.kind]
  return L.divIcon({
    className: '',
    html: `<span class="wb-pin ${cls}${active ? ' wb-pin--active' : ''}" style="width:${size}px;height:${size}px">${p.number ?? ''}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    // The label sits beside the pin on either side (Leaflet mirrors this anchor for a label on the left).
    tooltipAnchor: [size / 2 + 2, 0],
  })
}

function FitBounds({ points, maxZoom }: { points: MapPoint[]; maxZoom: number }) {
  const map = useMap()
  // Refit only when the main pins change: opening the list of other towns must not undo the user's pan and zoom.
  const key = points
    .filter((p) => p.kind !== 'dot')
    .map((p) => `${p.id}:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`)
    .join('|')
  useEffect(() => {
    // Fit the pins that matter (the start and the candidates); the small dots may run off the edge.
    const main = points.filter((p) => p.kind !== 'dot')
    const fit = main.length >= 2 ? main : points
    if (fit.length === 0) return
    const bounds = L.latLngBounds(fit.map((p) => [p.lat, p.lon]))
    // Room around the pins for their labels, so no label is cut by the map's edge.
    map.fitBounds(bounds, { padding: [64, 40], maxZoom })
    // Only when the set of points changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, maxZoom])
  return null
}

export function TripMap({
  points,
  label,
  className = '',
  maxZoom = 14,
  activeId,
}: {
  points: MapPoint[]
  label: string
  className?: string
  /** How close the map may zoom in to fit the points (one town: keep its surroundings in view). */
  maxZoom?: number
  /** The pin to highlight - the town whose card is under the pointer or the keyboard focus. */
  activeId?: string | null
}) {
  // Icons are rebuilt only when a pin really changes (kind, number, highlight) - not on every render or hover elsewhere.
  const signature = points.map((p) => `${p.id}|${p.kind}|${p.number ?? ''}|${p.id === activeId ? 1 : 0}`).join(';')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const icons = useMemo(() => new Map(points.map((p) => [p.id, icon(p, p.id === activeId)])), [signature])
  // Draw the dots first, the important pins on top.
  const ordered = useMemo(() => [...points].sort((a, b) => order(a) - order(b)), [points])
  const centre: [number, number] = points.length ? [points[0].lat, points[0].lon] : [50.55, 9.68]
  return (
    <div role="region" aria-label={label} className={`isolate overflow-hidden rounded-lg border-2 border-line bg-primary-soft ${className}`}>
      <MapContainer center={centre} zoom={9} scrollWheelZoom={false} dragging={!L.Browser.mobile} className="size-full">
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        {ordered.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lon]}
            icon={icons.get(p.id)!}
            title={p.label}
            zIndexOffset={zIndexOf(p, p.id === activeId)}
            alt={p.label}
            keyboard={Boolean(p.onSelect)}
            eventHandlers={p.onSelect ? { click: p.onSelect, keypress: onEnter(p.onSelect) } : undefined}
          >
            <Tooltip
              className="wb-label"
              // Right of the pin in the left half of the map, left of it in the right half: never off the edge.
              direction="auto"
              permanent={p.kind !== 'dot'}
            >
              {p.label}
            </Tooltip>
          </Marker>
        ))}
        <FitBounds points={points} maxZoom={maxZoom} />
        <Declutter points={points} activeId={activeId ?? null} />
      </MapContainer>
    </div>
  )
}

/**
 * Which pin lies on top where pins overlap: the highlighted one, then by kind (the start, the top towns, the steps
 * ...), and among numbered pins the smaller number - town 1 is never hidden under town 3. Leaflet adds the offset
 * to the pin's vertical screen position (up to a few thousand px), so each step is far bigger than that.
 */
function zIndexOf(p: MapPoint, active: boolean): number {
  if (active) return 100_000_000
  return order(p) * 10_000_000 + (p.number ? (100 - Math.min(p.number, 99)) * 10_000 : 0)
}

/**
 * Permanent labels of pins that are close together cover each other (a town's sights 50 m apart; two towns 5 km
 * apart on a phone-sized map of the whole region). After every zoom and move, a label that would overlap a more
 * important pin or label is hidden; it comes back when there is room. The name stays on the pin (title, alt).
 */
function Declutter({ points, activeId }: { points: MapPoint[]; activeId: string | null }) {
  const map = useMap()
  const signature = points.map((p) => `${p.id}|${p.kind}|${p.number ?? ''}|${p.lat},${p.lon}|${p.label}`).join(';') + `|${activeId ?? ''}`
  useEffect(() => {
    const byPlace = new Map(points.map((p) => [`${p.lat},${p.lon}|${p.label}`, p]))
    const run = () => {
      const pins: { marker: L.Marker; rank: number }[] = []
      map.eachLayer((layer) => {
        if (!(layer instanceof L.Marker)) return
        const { lat, lng } = layer.getLatLng()
        const p = byPlace.get(`${lat},${lng}|${layer.options.title ?? ''}`)
        if (p) pins.push({ marker: layer, rank: zIndexOf(p, p.id === activeId) })
      })
      pins.sort((a, b) => b.rank - a.rank)
      const taken: DOMRect[] = []
      const free = (r: DOMRect) => taken.every((t) => r.right < t.left || r.left > t.right || r.bottom < t.top || r.top > t.bottom)
      for (const { marker } of pins) {
        const pin = marker.getElement()?.getBoundingClientRect()
        const tooltip = marker.getTooltip()
        const label = tooltip?.options.permanent ? tooltip.getElement() : undefined
        if (label) {
          label.style.visibility = ''
          const box = label.getBoundingClientRect()
          if (free(box)) taken.push(box)
          else label.style.visibility = 'hidden'
        }
        if (pin) taken.push(pin)
      }
    }
    // Labels open a moment after the pins are added: wait for the next frame.
    const frame = requestAnimationFrame(run)
    map.on('zoomend moveend resize', run)
    return () => {
      cancelAnimationFrame(frame)
      map.off('zoomend moveend resize', run)
    }
    // `signature` describes the points and the highlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature])
  return null
}

/** A focused pin opens with Enter or Space, as a button does - not with any key. */
const onEnter = (select: () => void) => (e: L.LeafletKeyboardEvent) => {
  if (e.originalEvent.key === 'Enter' || e.originalEvent.key === ' ') select()
}

const order = (p: MapPoint) => ({ dot: 0, candidate: 1, step: 2, done: 2, top: 3, origin: 4 })[p.kind]
