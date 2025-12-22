/**
 * Room Domain Service
 * 
 * Pure business logic for Room entity.
 * Stateless functions that contain room-related business rules and validations.
 * No side effects, no API calls, no store updates.
 * 
 * Responsibilities:
 * - Room validation rules
 * - Room lifecycle business logic  
 * - Room permission checks
 * - Room state transitions
 * - Room visibility rules
 */

import { pipe } from 'effect'
import type { RoomMetadataType } from '../../domain/schemas/room.schema'

/**
 * Room validation result
 */
export interface RoomValidationResult {
  isValid: boolean
  errors: string[]
}

/**
 * Room creation request
 */
export interface RoomCreationRequest {
  name: string
  djName: string
  description?: string
  tags?: string[]
}

/**
 * Room business rules constants
 */
export const ROOM_BUSINESS_RULES = {
  NAME_MIN_LENGTH: 3,
  NAME_MAX_LENGTH: 50,
  DJ_NAME_MIN_LENGTH: 2,
  DJ_NAME_MAX_LENGTH: 30,
  DESCRIPTION_MAX_LENGTH: 200,
  MAX_TAGS: 5,
  TAG_MAX_LENGTH: 20,
  MAX_CONCURRENT_ROOMS_PER_DJ: 1,
  MIN_LISTENER_COUNT_FOR_TRENDING: 10
} as const

/**
 * Room state types
 */
export type RoomState = 'setup' | 'public' | 'streaming' | 'paused' | 'closed'
export type RoomVisibility = 'private' | 'public' | 'unlisted'

/**
 * Room Domain Service
 * 
 * All methods are pure functions that return validation/calculation results.
 * No external dependencies or side effects.
 */
export class Room {
  /**
   * Validate room creation request
   */
  static validateCreationRequest(request: RoomCreationRequest): RoomValidationResult {
    const errors: string[] = []

    // Validate room name
    if (!request.name || request.name.trim().length === 0) {
      errors.push('Room name is required')
    } else {
      const trimmedName = request.name.trim()
      if (trimmedName.length < ROOM_BUSINESS_RULES.NAME_MIN_LENGTH) {
        errors.push(`Room name must be at least ${ROOM_BUSINESS_RULES.NAME_MIN_LENGTH} characters`)
      }
      if (trimmedName.length > ROOM_BUSINESS_RULES.NAME_MAX_LENGTH) {
        errors.push(`Room name cannot exceed ${ROOM_BUSINESS_RULES.NAME_MAX_LENGTH} characters`)
      }
      if (!/^[a-zA-Z0-9\s\-_'".!?]+$/.test(trimmedName)) {
        errors.push('Room name contains invalid characters')
      }
    }

    // Validate DJ name
    if (!request.djName || request.djName.trim().length === 0) {
      errors.push('DJ name is required')
    } else {
      const trimmedDjName = request.djName.trim()
      if (trimmedDjName.length < ROOM_BUSINESS_RULES.DJ_NAME_MIN_LENGTH) {
        errors.push(`DJ name must be at least ${ROOM_BUSINESS_RULES.DJ_NAME_MIN_LENGTH} characters`)
      }
      if (trimmedDjName.length > ROOM_BUSINESS_RULES.DJ_NAME_MAX_LENGTH) {
        errors.push(`DJ name cannot exceed ${ROOM_BUSINESS_RULES.DJ_NAME_MAX_LENGTH} characters`)
      }
      if (!/^[a-zA-Z0-9\s\-_'.]+$/.test(trimmedDjName)) {
        errors.push('DJ name contains invalid characters')
      }
    }

    // Validate description
    if (request.description && request.description.length > ROOM_BUSINESS_RULES.DESCRIPTION_MAX_LENGTH) {
      errors.push(`Description cannot exceed ${ROOM_BUSINESS_RULES.DESCRIPTION_MAX_LENGTH} characters`)
    }

    // Validate tags
    if (request.tags) {
      if (request.tags.length > ROOM_BUSINESS_RULES.MAX_TAGS) {
        errors.push(`Cannot have more than ${ROOM_BUSINESS_RULES.MAX_TAGS} tags`)
      }
      
      request.tags.forEach((tag, index) => {
        if (!tag || tag.trim().length === 0) {
          errors.push(`Tag ${index + 1} is empty`)
        } else if (tag.trim().length > ROOM_BUSINESS_RULES.TAG_MAX_LENGTH) {
          errors.push(`Tag "${tag}" exceeds ${ROOM_BUSINESS_RULES.TAG_MAX_LENGTH} characters`)
        } else if (!/^[a-zA-Z0-9\-_]+$/.test(tag.trim())) {
          errors.push(`Tag "${tag}" contains invalid characters`)
        }
      })
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Determine room visibility based on streaming state and listener count
   */
  static determineVisibility(
    isStreaming: boolean, 
    _listenerCount: number, 
    djPreference: RoomVisibility = 'public'
  ): RoomVisibility {
    // Business rule: rooms are only visible when actively streaming
    if (!isStreaming) {
      return 'private'
    }
    
    // Respect DJ preference for public rooms
    return djPreference
  }

  /**
   * Check if room should be featured/trending
   */
  static shouldBeFeatured(listenerCount: number, isStreaming: boolean, roomAge: number): boolean {
    return isStreaming && 
           listenerCount >= ROOM_BUSINESS_RULES.MIN_LISTENER_COUNT_FOR_TRENDING &&
           roomAge <= 24 * 60 * 60 * 1000 // 24 hours in milliseconds
  }

  /**
   * Validate room state transition
   */
  static canTransitionState(from: RoomState, to: RoomState): boolean {
    const validTransitions: Record<RoomState, RoomState[]> = {
      'setup': ['public', 'closed'],
      'public': ['streaming', 'closed'],
      'streaming': ['paused', 'public', 'closed'],
      'paused': ['streaming', 'closed'],
      'closed': [] // Terminal state
    }

    return validTransitions[from]?.includes(to) ?? false
  }

  /**
   * Calculate room priority for listing (higher = more important)
   */
  static calculateListingPriority(
    listenerCount: number,
    isStreaming: boolean,
    roomAge: number,
    isFeatured: boolean
  ): number {
    let priority = 0
    
    // Base priority from listener count
    priority += listenerCount * 10
    
    // Streaming bonus
    if (isStreaming) {
      priority += 100
    }
    
    // Featured/trending bonus
    if (isFeatured) {
      priority += 1000
    }
    
    // Age penalty (older rooms get lower priority)
    const ageHours = roomAge / (60 * 60 * 1000)
    priority -= Math.floor(ageHours * 5)
    
    return Math.max(0, priority)
  }

  /**
   * Check if user can create a room
   */
  static canUserCreateRoom(userActiveRoomCount: number, userRole?: string): boolean {
    // Business rule: regular users can only have one active room
    if (userActiveRoomCount >= ROOM_BUSINESS_RULES.MAX_CONCURRENT_ROOMS_PER_DJ) {
      return false
    }
    
    return true
  }

  /**
   * Check if user can join a room
   */
  static canUserJoinRoom(
    roomState: RoomState,
    roomVisibility: RoomVisibility,
    isUserOwner: boolean
  ): boolean {
    // Owner can always join their own room
    if (isUserOwner) {
      return true
    }
    
    // Can only join public rooms that are open
    return roomVisibility === 'public' && 
           (roomState === 'public' || roomState === 'streaming' || roomState === 'paused')
  }

  /**
   * Determine room capacity status
   */
  static getCapacityStatus(listenerCount: number, maxCapacity: number = 100): 'low' | 'medium' | 'high' | 'full' {
    const percentage = (listenerCount / maxCapacity) * 100
    
    if (percentage >= 100) return 'full'
    if (percentage >= 80) return 'high'
    if (percentage >= 50) return 'medium'
    return 'low'
  }

  /**
   * Generate room URL slug
   */
  static generateUrlSlug(roomName: string, roomId?: string): string {
    const slug = roomName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    
    // Add room ID suffix if provided to ensure uniqueness
    return roomId ? `${slug}-${roomId.slice(0, 8)}` : slug
  }

  /**
   * Calculate estimated stream quality based on listener count
   */
  static estimateStreamQuality(listenerCount: number): 'low' | 'medium' | 'high' | 'auto' {
    // Business rule: adjust quality based on load
    if (listenerCount > 50) return 'medium' // Reduce quality for many listeners
    if (listenerCount > 100) return 'low' // Further reduce for very many listeners
    return 'high' // High quality for small audiences
  }

  /**
   * Validate room metadata update
   */
  static validateMetadataUpdate(
    currentMetadata: RoomMetadataType,
    updates: Partial<RoomMetadataType>,
    isOwner: boolean
  ): RoomValidationResult {
    const errors: string[] = []

    // Only room owner can update metadata
    if (!isOwner) {
      errors.push('Only room owner can update metadata')
      return { isValid: false, errors }
    }

    // Validate name update
    if (updates.name !== undefined) {
      if (!updates.name || updates.name.trim().length < ROOM_BUSINESS_RULES.NAME_MIN_LENGTH) {
        errors.push(`Room name must be at least ${ROOM_BUSINESS_RULES.NAME_MIN_LENGTH} characters`)
      }
      if (updates.name.trim().length > ROOM_BUSINESS_RULES.NAME_MAX_LENGTH) {
        errors.push(`Room name cannot exceed ${ROOM_BUSINESS_RULES.NAME_MAX_LENGTH} characters`)
      }
    }

    // Validate description update
    if (updates.description !== undefined) {
      const desc = updates.description
      if (desc && typeof desc === 'object' && 'value' in desc) {
        // Handle Option<string> type
        const descValue = (desc as any).value
        if (descValue && descValue.length > ROOM_BUSINESS_RULES.DESCRIPTION_MAX_LENGTH) {
          errors.push(`Description cannot exceed ${ROOM_BUSINESS_RULES.DESCRIPTION_MAX_LENGTH} characters`)
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }
}