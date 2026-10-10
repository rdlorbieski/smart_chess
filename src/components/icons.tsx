/** Small stroke icons (24×24 grid, currentColor) for the rail and the panel toolbar. */
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  upload: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 18v-6M9 15l3-3 3 3',
  library: 'M4 19V5a1 1 0 0 1 1-1h3v15M8 4h3v15M14.5 5.5l3-.8 3.6 13.5-3 .8z M3 20h11',
  save: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  robot: 'M12 3v3M7 6h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM9.5 11v1M14.5 11v1M9 15h6M2 12h3M19 12h3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  flip: 'M4 8a8 8 0 0 1 14-3l2 2M20 3v4h-4M20 16a8 8 0 0 1-14 3l-2-2M4 21v-4h4',
  arrow: 'M5 19 19 5M10 5h9v9',
  trap: 'M12 3 2 20h20zM12 10v4M12 17v.5',
  soundOn: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  soundOff: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6',
  first: 'M6 5v14M18 6l-7 6 7 6',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  last: 'M18 5v14M6 6l7 6-7 6',
  moves: 'M4 6h16M4 12h16M4 18h10',
  analysis: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l5 5M8 11h6M11 8v6',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13',
  chart: 'M3 20h18M5 16l4-5 4 3 6-8',
} as const

export type IconName = keyof typeof PATHS

export default function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
