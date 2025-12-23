/**
 * Audio Infrastructure Client Interface
 * 
 * Infrastructure service that manages MediaStream and audio devices.
 * State is managed via AudioAdapter/Store.
 */

import { Context, Layer, Effect, Option } from 'effect'
import type { 
  AudioServiceError,
  WebAPITypes 
} from '../../../domain/schemas/audio.schema'

/**
 * Audio Client Interface
 * 
 * Infrastructure layer for audio device and stream management.
 * State is persisted in AudioAdapter/Store.
 */
export interface AudioClient {
  // Device Management
  readonly getAudioDevices: () => Effect.Effect<
    ReadonlyArray<WebAPITypes.MediaDeviceInfo>, 
    AudioServiceError, 
    never
  >
  
  // Device Selection (for DJ mic input)
  // Updates state in AudioAdapter
  readonly selectDevice: (deviceId: string) => Effect.Effect<
    MediaStream,
    AudioServiceError,
    AudioAdapter
  >
  
  // Remote Stream (for listener playback)
  // Updates state in AudioAdapter
  readonly connectRemoteStream: (stream: MediaStream) => Effect.Effect<
    void,
    AudioServiceError,
    AudioAdapter
  >
  
  // Stop any active stream
  // Updates state in AudioAdapter
  readonly stopStream: () => Effect.Effect<
    void,
    never,
    AudioAdapter
  >
  
  // Get current stream (internal use by other services)
  readonly getCurrentStream: () => Option.Option<MediaStream>
}

/**
 * Audio Client Context Tag
 */
export class AudioClient extends Context.Tag("@app/infrastructure/AudioClient")<
  AudioClient,
  AudioClient
>() {}

/**
 * Lazy Layer for Audio Client
 * 
 * Implementation is loaded only when first used
 */
export const AudioClientLazy = Layer.unwrapEffect(
  Effect.promise(async () => {
    // Dynamic import for code splitting
    const { AudioClientLive } = await import("./implementation")
    return AudioClientLive
  })
)

// Import AudioAdapter type from store
import { AudioAdapter } from '../../../stores'