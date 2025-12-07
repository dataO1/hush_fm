import { Show } from 'solid-js'

export type StreamStatus = 'live' | 'muted' | 'connecting' | 'error'

interface StreamStatusBadgeProps {
  status: StreamStatus
  listenerCount?: number
}

export function StreamStatusBadge(props: StreamStatusBadgeProps) {
  return (
    <div class="flex items-center gap-3">
      <div class={`px-3 py-2 rounded-full text-sm font-semibold flex items-center gap-2 ${
        props.status === 'live' ? 'bg-red-100 text-red-700' :
        props.status === 'muted' ? 'bg-orange-100 text-orange-700' :
        props.status === 'connecting' ? 'bg-blue-100 text-blue-700' :
        'bg-gray-100 text-gray-700'
      }`}>
        <Show when={props.status === 'live'}>
          <div class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
          🔴 LIVE
        </Show>
        <Show when={props.status === 'muted'}>
          <span>🔇 DJ MUTED</span>
        </Show>
        <Show when={props.status === 'connecting'}>
          <div class="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          Connecting...
        </Show>
        <Show when={props.status === 'error'}>
          <span>❌ Error</span>
        </Show>
      </div>
      
      <Show when={props.listenerCount !== undefined}>
        <div class="text-sm text-gray-600">
          {props.listenerCount} listeners
        </div>
      </Show>
    </div>
  )
}