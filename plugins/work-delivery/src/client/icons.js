export function WorkDeliveryNavIcon({ React, size = 18 }) {
  const h = React.createElement
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.85,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      style: { display: 'block' },
    },
    h('rect', { x: 3, y: 7, width: 18, height: 13, rx: 2.5 }),
    h('path', { d: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
    h('path', { d: 'M9 13.5l2 2 4-4' }),
  )
}

export function RefreshIcon({ React, size = 15 }) {
  const h = React.createElement
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
    h('polyline', { points: '21 3 21 9 15 9' }),
  )
}

export function GlobeIcon({ React, size = 15 }) {
  const h = React.createElement
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('circle', { cx: 12, cy: 12, r: 9 }),
    h('path', { d: 'M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' }),
  )
}

export function ServerIcon({ React, size = 15 }) {
  const h = React.createElement
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('rect', { x: 3, y: 4, width: 18, height: 6, rx: 1.5 }),
    h('rect', { x: 3, y: 14, width: 18, height: 6, rx: 1.5 }),
    h('circle', { cx: 7, cy: 7, r: 0.9, fill: 'currentColor' }),
    h('circle', { cx: 7, cy: 17, r: 0.9, fill: 'currentColor' }),
  )
}

export function CheckIcon({ React, size = 14 }) {
  const h = React.createElement
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.3, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('polyline', { points: '20 6 9 17 4 12' }),
  )
}

export function ExternalLinkIcon({ React, size = 14 }) {
  const h = React.createElement
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
    h('polyline', { points: '15 3 21 3 21 9' }),
    h('line', { x1: 10, y1: 14, x2: 21, y2: 3 }),
  )
}

export function TrashIcon({ React, size = 14 }) {
  const h = React.createElement
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('polyline', { points: '3 6 5 6 21 6' }),
    h('path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }),
    h('path', { d: 'M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }),
  )
}

export function ChevronIcon({ React, size = 14, expanded = false }) {
  const h = React.createElement
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      style: { transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 140ms ease' },
    },
    h('polyline', { points: '9 18 15 12 9 6' }),
  )
}
