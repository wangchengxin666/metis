import { cn } from './ui'

export const DEFAULT_METIS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">' +
  '<defs>' +
  '<linearGradient id="metis-bg" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0%" stop-color="#6366f1"/>' +
  '<stop offset="55%" stop-color="#7c3aed"/>' +
  '<stop offset="100%" stop-color="#06b6d4"/>' +
  '</linearGradient>' +
  '</defs>' +
  '<rect width="64" height="64" rx="16" fill="url(#metis-bg)"/>' +
  '<path d="M16 45V21l16 14 16-14v24" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M32 13l2.6 5.4 5.4 2.6-5.4 2.6L32 29l-2.6-5.4L24 21l5.4-2.6L32 13z" fill="#e0f2fe"/>' +
  '</svg>'

export function svgToDataUri(svg: string): string {
  const cleaned = (svg || '').trim() || DEFAULT_METIS_SVG
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleaned)}`
}

export function resolveFaviconHref(favicon?: string | null, logoSvg?: string | null): string {
  const fav = (favicon || '').trim()
  if (fav) {
    if (fav.startsWith('<')) return svgToDataUri(fav)
    if (
      fav.startsWith('data:image/') ||
      fav.startsWith('http://') ||
      fav.startsWith('https://') ||
      fav.startsWith('/')
    ) {
      return fav
    }
  }
  const logo = (logoSvg || '').trim()
  return svgToDataUri(logo || DEFAULT_METIS_SVG)
}

export function applyDocumentFavicon(favicon?: string | null, logoSvg?: string | null): void {
  if (typeof document === 'undefined' || !document.head) return
  const href = resolveFaviconHref(favicon, logoSvg)
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = href.startsWith('data:image/svg+xml') ? 'image/svg+xml' : ''
  link.href = href
}

export function BrandMark({
  svg,
  name = 'Metis',
  className,
}: {
  svg?: string | null
  name?: string
  className?: string
}) {
  const src = svgToDataUri((svg || '').trim() || DEFAULT_METIS_SVG)
  return (
    <div
      className={cn(
        'flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg shadow-sm shrink-0',
        className,
      )}
    >
      <img src={src} alt={name} className="h-full w-full object-contain" />
    </div>
  )
}
