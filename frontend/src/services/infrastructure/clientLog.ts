/**
 * Client-log beacon (frontend half — decisions 7.1–7.6).
 *
 * Plain infrastructure module (NOT an Effect service): this runs at the very
 * edge of the app inside global browser error handlers, where an Effect runtime
 * is not guaranteed to be available and where we must NEVER throw, block, or
 * affect the user. A tiny vanilla module is the correct shape here — the
 * Effect-TS conventions apply to the app's business/error channel, not to a
 * fire-and-forget diagnostics beacon that must survive the page dying.
 *
 * Design (user-approved):
 *  - 7.1 Capture ONLY when something bad happens. No ring buffer, no periodic
 *    capture. We hook `window.onerror` (uncaught exceptions) and
 *    `unhandledrejection` (rejected promises) and build+send a report per event.
 *  - 7.2 Flush is event-driven: each captured error sends immediately, and the
 *    last pending report is flushed on `pagehide` via `navigator.sendBeacon`
 *    (survives the page being killed). The live path prefers sendBeacon and
 *    falls back to `fetch(..., { keepalive: true })`.
 *  - 7.3 Each report is tagged with the persistent device id (localStorage
 *    `hushfm-device-id`, the X5 id — read, never regenerated), role (best-effort
 *    from the current route), roomId (best-effort from the current route), the
 *    user agent, and the app build (if exposed via import.meta.env).
 *  - 7.6 Strictly best-effort, ZERO user impact: every path is wrapped in
 *    try/catch, all errors are swallowed, nothing throws or blocks. No retry on
 *    failure (offline → fail silently, no storm).
 */

/** localStorage key for the persistent per-device random id (X5). */
const DEVICE_ID_STORAGE_KEY = 'hushfm-device-id'

/** Backend endpoint (same-origin; nginx/proxy routes /api → backend). */
const CLIENT_LOG_ENDPOINT = '/api/client-log'

/**
 * Shape of a single captured error inside a report. Kept minimal and
 * string-only so the payload is trivially JSON-serialisable and safe to send
 * even when the original error object is exotic.
 */
export interface ClientLogErrorEntry {
  readonly kind: 'error' | 'unhandledrejection' | 'manual'
  readonly message: string
  readonly stack?: string
  readonly source?: string
  readonly line?: number
  readonly column?: number
}

/**
 * The report body POSTed to the backend. The server sanitises `deviceId` and
 * writes one `<deviceId>.jsonl` per device; we just send what we know.
 * Additional caller context is spread in as extra top-level fields.
 */
export interface ClientLogReport {
  readonly deviceId: string
  readonly role?: string
  readonly roomId?: string
  readonly ua: string
  readonly appBuild?: string
  readonly ts: string
  readonly url: string
  readonly errors: ReadonlyArray<ClientLogErrorEntry>
  readonly [key: string]: unknown
}

/** Guard so the global hooks are only wired once, even if init is called twice. */
let initialised = false

/**
 * The most recent report we built but may not have confirmed delivery for.
 * Used solely so `pagehide` can flush a last report via sendBeacon if the page
 * is dying right after an error fired. Best-effort; never a queue.
 */
let pendingReport: ClientLogReport | null = null

/**
 * Read the persistent device id (X5) straight from localStorage. Returns the
 * raw stored value (no `session-` prefixing — the beacon sends the bare id and
 * the server sanitises it). Never throws.
 */
function readDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)
    if (existing !== null && existing.trim() !== '') {
      return existing
    }
  } catch {
    // localStorage blocked (private mode / storage policy) — fall through.
  }
  return 'unknown'
}

/**
 * Best-effort role from the current route path.
 *   /dj/:roomId      → 'dj'
 *   /listen/:roomId  → 'listener'
 *   /                → 'lobby'
 * Returns undefined if the path doesn't match a known shape (omit the tag).
 */
function readRole(): string | undefined {
  try {
    const path = window.location.pathname
    if (path.startsWith('/dj/')) return 'dj'
    if (path.startsWith('/listen/')) return 'listener'
    if (path === '/' || path === '') return 'lobby'
  } catch {
    // ignore
  }
  return undefined
}

/**
 * Best-effort roomId from the current route path (/dj/:roomId, /listen/:roomId).
 * Returns undefined when there is no room segment.
 */
function readRoomId(): string | undefined {
  try {
    const match = window.location.pathname.match(/^\/(?:dj|listen)\/([^/?#]+)/)
    if (match && match[1]) return decodeURIComponent(match[1])
  } catch {
    // ignore
  }
  return undefined
}

/**
 * App build/version, if exposed at build time. We read a couple of common
 * `import.meta.env` keys and omit the tag entirely when none are present.
 */
function readAppBuild(): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env
    if (env) {
      const candidate = env.VITE_APP_BUILD ?? env.VITE_APP_VERSION ?? env.HUSHFM_APP_BUILD
      if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
    }
  } catch {
    // ignore
  }
  return undefined
}

/**
 * Assemble a report from a set of captured error entries plus optional extra
 * context. All tagging is best-effort; missing fields are simply omitted.
 */
function buildReport(
  errors: ReadonlyArray<ClientLogErrorEntry>,
  context?: Record<string, unknown>
): ClientLogReport {
  const report: Record<string, unknown> = {
    deviceId: readDeviceId(),
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    ts: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
    errors
  }

  const role = readRole()
  if (role) report.role = role
  const roomId = readRoomId()
  if (roomId) report.roomId = roomId
  const appBuild = readAppBuild()
  if (appBuild) report.appBuild = appBuild

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      // Don't let caller context clobber the core identity fields.
      if (key in report) continue
      report[key] = value
    }
  }

  return report as ClientLogReport
}

/**
 * Send a report best-effort. Prefers `sendBeacon` (queued by the browser,
 * survives the page dying); falls back to `fetch` with keepalive. NEVER throws,
 * NEVER retries — an unreachable endpoint (offline) just fails silently.
 */
function sendReport(report: ClientLogReport): void {
  try {
    const body = JSON.stringify(report)

    // Prefer sendBeacon: fire-and-forget, immune to the page unloading.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' })
        const queued = navigator.sendBeacon(CLIENT_LOG_ENDPOINT, blob)
        if (queued) return
        // If sendBeacon refused (e.g. payload too large), fall through to fetch.
      } catch {
        // fall through to fetch
      }
    }

    // Fallback: keepalive fetch so an in-flight request can outlive the page.
    // Swallow every failure — no retry, no storm.
    if (typeof fetch === 'function') {
      void fetch(CLIENT_LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {
        /* offline / unreachable — fail silently */
      })
    }
  } catch {
    // Absolutely never let the beacon path throw into the caller.
  }
}

/**
 * Public: deliberately log a client error with optional context. Safe to call
 * anywhere — fully guarded, never throws, never blocks. Not wired into other
 * modules for v1 (global hooks are the scope), but exposed for future use.
 */
export function logClientError(error: unknown, context?: Record<string, unknown>): void {
  try {
    const entry = errorToEntry(error, 'manual')
    const report = buildReport([entry], context)
    pendingReport = report
    sendReport(report)
  } catch {
    // swallow
  }
}

/** Normalise an arbitrary thrown value into a serialisable entry. */
function errorToEntry(error: unknown, kind: ClientLogErrorEntry['kind']): ClientLogErrorEntry {
  try {
    if (error instanceof Error) {
      return {
        kind,
        message: error.message || String(error),
        ...(error.stack ? { stack: error.stack } : {})
      }
    }
    if (typeof error === 'string') {
      return { kind, message: error }
    }
    return { kind, message: safeStringify(error) }
  } catch {
    return { kind, message: 'unserialisable error' }
  }
}

/** JSON.stringify that never throws (falls back to String()). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    try {
      return String(value)
    } catch {
      return 'unstringifiable'
    }
  }
}

/**
 * Wire the global error hooks ONCE. Idempotent. Everything inside is guarded;
 * a failure to install a listener must not break app bootstrap.
 */
export function initClientLog(): void {
  try {
    if (initialised) return
    if (typeof window === 'undefined') return
    initialised = true

    // 7.1 uncaught exceptions
    window.addEventListener('error', (event: ErrorEvent) => {
      try {
        const entry: ClientLogErrorEntry = {
          kind: 'error',
          message: event.message || (event.error ? String(event.error) : 'unknown error'),
          ...(event.error instanceof Error && event.error.stack ? { stack: event.error.stack } : {}),
          ...(event.filename ? { source: event.filename } : {}),
          ...(typeof event.lineno === 'number' ? { line: event.lineno } : {}),
          ...(typeof event.colno === 'number' ? { column: event.colno } : {})
        }
        const report = buildReport([entry])
        pendingReport = report
        sendReport(report)
      } catch {
        // swallow — zero user impact
      }
    })

    // 7.1 unhandled promise rejections
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      try {
        const entry = errorToEntry(event.reason, 'unhandledrejection')
        const report = buildReport([entry])
        pendingReport = report
        sendReport(report)
      } catch {
        // swallow — zero user impact
      }
    })

    // 7.2 flush the last pending report if the page is dying. sendBeacon is the
    // only transport reliable during pagehide. We do NOT clear on visibility
    // changes — only a true teardown. Re-sending the last report on pagehide is
    // acceptable (best-effort diagnostics), and only happens if one is pending.
    window.addEventListener('pagehide', () => {
      try {
        if (pendingReport) {
          sendReport(pendingReport)
        }
      } catch {
        // swallow
      }
    })
  } catch {
    // Never let diagnostics wiring break the app.
  }
}
