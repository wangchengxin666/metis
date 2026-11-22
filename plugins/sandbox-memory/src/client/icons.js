function svg(React, size, viewBox, children, extra = {}) {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.75,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      style: { display: 'block', flexShrink: 0, ...(extra.style || {}) },
      ...extra,
    },
    ...children,
  )
}

export function MemoryNavIcon({ React, size = 18 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', {
      key: 'bulb',
      d: 'M12 3a6.5 6.5 0 0 0-4.1 11.55c.62.5 1.1 1.2 1.24 1.98L9.4 18h5.2l.26-1.47c.14-.78.62-1.48 1.24-1.98A6.5 6.5 0 0 0 12 3Z',
    }),
    React.createElement('circle', { key: 'n1', cx: 9.8, cy: 9.5, r: 1, fill: 'currentColor', stroke: 'none' }),
    React.createElement('circle', { key: 'n2', cx: 14.2, cy: 9.5, r: 1, fill: 'currentColor', stroke: 'none' }),
    React.createElement('circle', { key: 'n3', cx: 12, cy: 13, r: 1, fill: 'currentColor', stroke: 'none' }),
    React.createElement('path', { key: 'l1', d: 'M10.4 10.2 11.5 12.2M13.6 10.2 12.5 12.2M10.6 9.5h2.8', strokeWidth: 1.25 }),
    React.createElement('path', { key: 'b1', d: 'M9.8 21h4.4' }),
  ])
}

export function PlusIcon({ React, size = 14 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', { key: 'p', d: 'M12 5v14M5 12h14' }),
  ])
}

export function SearchIcon({ React, size = 14 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('circle', { key: 'c', cx: 11, cy: 11, r: 7 }),
    React.createElement('path', { key: 'p', d: 'm20 20-3.5-3.5' }),
  ])
}

export function RefreshIcon({ React, size = 14 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', { key: 'p1', d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
    React.createElement('path', { key: 'p2', d: 'M21 3v6h-6' }),
  ])
}

export function PinIcon({ React, size = 13, filled = false }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', {
      key: 'p',
      d: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76Z',
      fill: filled ? 'currentColor' : 'none',
    }),
  ])
}

export function EditIcon({ React, size = 13 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', { key: 'p1', d: 'M12 20h9' }),
    React.createElement('path', { key: 'p2', d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z' }),
  ])
}

export function TrashIcon({ React, size = 13 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', { key: 'p1', d: 'M3 6h18' }),
    React.createElement('path', { key: 'p2', d: 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2' }),
    React.createElement('path', { key: 'p3', d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }),
  ])
}

export function SparkleIcon({ React, size = 13 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', {
      key: 'p',
      d: 'M12 3l2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1L12 3Z',
    }),
  ])
}

export function ServerIcon({ React, size = 14 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('rect', { key: 'r1', x: 3, y: 4, width: 18, height: 6, rx: 2 }),
    React.createElement('rect', { key: 'r2', x: 3, y: 14, width: 18, height: 6, rx: 2 }),
    React.createElement('circle', { key: 'c1', cx: 7, cy: 7, r: 0.9, fill: 'currentColor', stroke: 'none' }),
    React.createElement('circle', { key: 'c2', cx: 7, cy: 17, r: 0.9, fill: 'currentColor', stroke: 'none' }),
  ])
}

export function FolderIcon({ React, size = 14 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', { key: 'p', d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' }),
  ])
}

export function GlobeIcon({ React, size = 14 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 9 }),
    React.createElement('path', { key: 'p1', d: 'M3.6 9h16.8M3.6 15h16.8' }),
    React.createElement('path', { key: 'p2', d: 'M12 3a13 13 0 0 0 0 18M12 3a13 13 0 0 1 0 18' }),
  ])
}

export function ClockIcon({ React, size = 14 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 9 }),
    React.createElement('path', { key: 'p', d: 'M12 7v5l3 2' }),
  ])
}

export function TerminalIcon({ React, size = 14 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', { key: 'p1', d: 'm4 17 6-5-6-5' }),
    React.createElement('path', { key: 'p2', d: 'M12 19h8' }),
  ])
}

export function CheckIcon({ React, size = 13 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', { key: 'p', d: 'm5 13 4 4L19 7' }),
  ])
}

export function ChevronIcon({ React, size = 13, expanded = false }) {
  return svg(
    React,
    size,
    '0 0 24 24',
    [React.createElement('path', { key: 'p', d: 'm9 6 6 6-6 6' })],
    { style: { transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 140ms ease' } },
  )
}

export function CloseIcon({ React, size = 14 }) {
  return svg(React, size, '0 0 24 24', [
    React.createElement('path', { key: 'p', d: 'M18 6 6 18M6 6l12 12' }),
  ])
}
