import { Effect, Layer, Runtime } from 'effect'
import { DevTools } from '@effect/experimental'
import { BrowserSocket } from '@effect/platform-browser'

// DevTools layer for browser applications
const DevToolsLive = DevTools.layerWebSocket().pipe(
  Layer.provide(BrowserSocket.layerWebSocketConstructor)
)

// Create a custom runtime with DevTools enabled
export const AppRuntime = Layer.toRuntime(DevToolsLive)

// Helper to run effects with DevTools tracing
export const runWithDevTools = <A, E>(
  effect: Effect.Effect<A, E>
): Promise<A> => {
  const runtime = Effect.runSync(AppRuntime)
  return Runtime.runPromise(runtime)(effect)
}
