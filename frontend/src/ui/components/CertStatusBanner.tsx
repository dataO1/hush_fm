import { Show, createSignal, onMount } from 'solid-js'
import { config } from '../../config'

/**
 * CertStatusBanner
 *
 * A thin, persistent, NON-dismissable top banner that surfaces the state of the
 * TLS certificate nginx serves, so the operator (DJ) catches a stale or
 * self-signed cert at the at-home pre-party test rather than at the door
 * (decision: docs/https-setup.md §6).
 *
 * It fetches `/health` ONCE on mount (best-effort). The backend exposes:
 *   - certDaysRemaining: integer days until the cert expires (may be negative),
 *     or null if the cert can't be read/parsed.
 *   - certIsRealLE: true for a real Let's Encrypt cert, false for
 *     self-signed/untrusted, or null if unreadable.
 *
 * Copy is operator-plain (no shell commands) because this renders on the public
 * Landing page too — a guest must be able to read it without confusion.
 *
 * Severity tiers (see the PRD table):
 *   HIDDEN   — real LE cert, > 30 days left → render nothing.
 *   INFO     — real LE cert, 15..30 days left.
 *   WARNING  — real LE cert, 1..14 days left.
 *   CRITICAL — expired (days ≤ 0) OR self-signed/untrusted (certIsRealLE false).
 *   UNKNOWN  — any field null OR the fetch failed → shown as a WARNING tier.
 */

type Severity = 'hidden' | 'info' | 'warning' | 'critical'

interface CertHealth {
  certDaysRemaining: number | null
  certIsRealLE: boolean | null
}

/** UNKNOWN sentinel: we couldn't determine the cert state (null field / fetch failure). */
const UNKNOWN: CertHealth = { certDaysRemaining: null, certIsRealLE: null }

/** Pluralise a whole-day count: "1 day" / "N days". */
function pluralizeDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

/**
 * Pure severity classifier over the two /health fields. Exported for testing.
 * UNKNOWN (either field null) maps to 'warning' with unknown copy.
 */
export function classifyCert(health: CertHealth): Severity {
  const { certDaysRemaining: days, certIsRealLE: isRealLE } = health

  // UNKNOWN → WARNING (decision: SHOW it). Any null field means we can't trust
  // the cert state, so warn rather than stay silent.
  if (days === null || isRealLE === null) return 'warning'

  // CRITICAL: expired, or a self-signed / untrusted cert.
  if (days <= 0) return 'critical'
  if (isRealLE === false) return 'critical'

  // From here the cert is real LE with a positive day count.
  if (days <= 14) return 'warning'
  if (days <= 30) return 'info'

  // Real LE cert with comfortable runway → nothing to say.
  return 'hidden'
}

/**
 * Pure copy generator matching the classified severity. Exported for testing.
 * Handles UNKNOWN (null fields) and negative-day (expired) cases explicitly so
 * we never print "-3 days".
 */
export function certBannerMessage(health: CertHealth): string {
  const { certDaysRemaining: days, certIsRealLE: isRealLE } = health

  // UNKNOWN copy.
  if (days === null || isRealLE === null) {
    return "⚠️ Couldn't verify the TLS certificate — boot the Pi with internet at home before the party to be safe."
  }

  // Expired (days ≤ 0): never render a negative day count.
  if (days <= 0) {
    return '⚠️ TLS certificate has expired — guests will see a security warning. Boot the Pi with internet at home to renew it.'
  }

  // Self-signed / untrusted (real LE == false) but not expired.
  if (isRealLE === false) {
    return '⚠️ No valid TLS certificate yet — guests will see a security warning. Boot the Pi with internet at home to obtain one.'
  }

  // WARNING tier: 1..14 days.
  if (days <= 14) {
    return `⚠️ TLS certificate expires in ${pluralizeDays(days)} — boot the Pi with internet at home soon, or guests will see a security warning.`
  }

  // INFO tier: 15..30 days.
  return `TLS certificate expires in ${pluralizeDays(days)}. Connect the Pi to the internet at home before the party to renew it.`
}

/** Tailwind/gruvbox classes for the two visible tiers. */
function tierClasses(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return 'bg-gruvbox-red text-gruvbox-fg-1'
    case 'warning':
      return 'bg-gruvbox-yellow text-gruvbox-bg-hard'
    case 'info':
    default:
      // INFO: gentle blue/gray.
      return 'bg-gruvbox-blue text-gruvbox-fg-1'
  }
}

/**
 * Best-effort, guarded one-shot fetch of /health. Any failure (network, non-2xx,
 * malformed body) resolves to UNKNOWN so the page NEVER crashes on infra checks.
 */
async function fetchCertHealth(): Promise<CertHealth> {
  try {
    const res = await fetch(`${config.api.baseUrl}/health`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return UNKNOWN

    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null) return UNKNOWN

    const record = body as Record<string, unknown>
    const rawDays = record['certDaysRemaining']
    const rawLE = record['certIsRealLE']

    // Accept only the exact expected shapes; anything else degrades to UNKNOWN
    // for that field (which classifies as WARNING).
    const certDaysRemaining =
      typeof rawDays === 'number' && Number.isFinite(rawDays) ? Math.trunc(rawDays) : null
    const certIsRealLE = typeof rawLE === 'boolean' ? rawLE : null

    return { certDaysRemaining, certIsRealLE }
  } catch (error) {
    console.warn('⚠️ CertStatusBanner: /health fetch failed — treating cert state as UNKNOWN', error)
    return UNKNOWN
  }
}

export default function CertStatusBanner() {
  // Start HIDDEN so nothing flashes before /health resolves; the fetch flips it.
  const [health, setHealth] = createSignal<CertHealth>({
    certDaysRemaining: 9999,
    certIsRealLE: true,
  })
  const [resolved, setResolved] = createSignal(false)

  onMount(async () => {
    const result = await fetchCertHealth()
    setHealth(result)
    setResolved(true)
  })

  const severity = () => (resolved() ? classifyCert(health()) : 'hidden')

  return (
    <Show when={severity() !== 'hidden'}>
      <div
        role="status"
        aria-live="polite"
        class={`w-full px-4 py-2 text-center text-sm font-medium ${tierClasses(severity())}`}
      >
        {certBannerMessage(health())}
      </div>
    </Show>
  )
}
