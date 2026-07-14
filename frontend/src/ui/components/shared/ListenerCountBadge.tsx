import type { JSX } from 'solid-js'

interface ListenerCountBadgeProps {
  /** Reactive getter for the live listener count. */
  count: () => number
}

/**
 * Minimal, unobtrusive live-listener count.
 *
 * Renders in the TOP-RIGHT corner of a `relative` card as a small muted
 * people-glyph + the number — deliberately NOT a "N listeners listening"
 * sentence and NOT an emoji. It's absolutely positioned, so the enclosing card
 * must be `relative`; it stays out of the vertical flex flow and never competes
 * with the status dot (which already states Live/Paused/Connecting).
 */
export function ListenerCountBadge(props: ListenerCountBadgeProps): JSX.Element {
  // Direct calls (never destructure) so the count stays reactive.
  const label = () => `${props.count()} ${props.count() === 1 ? 'listener' : 'listeners'}`

  return (
    <div
      class="absolute top-3 right-3 flex items-center gap-1 text-gruvbox-fg-3 select-none pointer-events-none"
      title={label()}
      aria-label={label()}
    >
      <svg
        class="w-3.5 h-3.5 sm:w-4 sm:h-4"
        fill="none"
        stroke="currentColor"
        stroke-width={1.5}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
        />
      </svg>
      <span class="text-xs sm:text-sm font-medium tabular-nums">{props.count()}</span>
    </div>
  )
}
