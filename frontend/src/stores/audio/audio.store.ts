import { createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'

/**
 * DJ actions interface (using schema-inferred types)
 */
export interface AudioActions {
  // Device management
  setSelectedDeviceId: (deviceId: string) => void
  clearSelectedDevice: () => void
}
