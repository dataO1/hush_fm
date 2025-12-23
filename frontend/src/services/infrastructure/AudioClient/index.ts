/**
 * Audio Service Exports
 * 
 * Main entry point for the Audio Service.
 * Only exports from interface to ensure lazy loading.
 */

export * from './interface'
export { AudioClientLive } from './implementation'