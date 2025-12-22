# Domain-Separated Stores Architecture

## Overview

This directory contains the new domain-driven store architecture for HushFM frontend. The monolithic `room.store.ts` has been decomposed into focused, independent domain stores using SolidJS's native reactivity.

## Architecture Benefits

### 🎯 **True Separation**
- Each store manages a single domain
- No cross-references between stores  
- Services use interfaces, not concrete stores

### ⚡ **Performance**
- Fine-grained reactivity per domain
- Smaller store updates trigger fewer re-renders
- Memory efficiency with focused state

### 🔧 **Maintainability**  
- Clear responsibilities per store
- Easier to test individual domains
- Reduced coupling between features

### 🔒 **Type Safety**
- Store interfaces prevent wrong store usage
- Compile-time guarantees for store interactions
- Clear API boundaries

## Store Structure

### Core Domain Stores

#### `connection.store.ts`
**Purpose**: Pure connection state management  
**Responsibilities**:
- Connection state (CONNECTING, CONNECTED, STREAMING, etc.)
- Room ID and connection type (dj/listener)
- Connection error handling
- Connection attempts tracking

#### `webrtc.store.ts`  
**Purpose**: WebRTC transport status management  
**Responsibilities**:
- WebRTC connection state (connecting, connected, failed)
- Transport-level error handling
- Timeout management for WebRTC operations
- Error type categorization (transport, producer, device, unknown)

#### `room-metadata.store.ts`
**Purpose**: Room information without participants  
**Responsibilities**:
- Room metadata (name, description, DJ name, tags)
- Streaming status (idle, streaming, paused, error)
- Room lifecycle management
- Stream duration tracking

#### `dj.store.ts`
**Purpose**: Self-contained DJ state with MediaSoup  
**Responsibilities**:
- DJ flow step tracking (18-step flow)
- Embedded MediaSoup device, transport, producer state
- Audio track and stream management
- Producer confirmation tracking
- Preview stream management

#### `listeners.store.ts`
**Purpose**: Collection of listener states  
**Responsibilities**:
- Multiple listener state management
- Listener flow step tracking (10-step flow)
- Embedded MediaSoup device, transport, consumer state
- Audio playback state per listener
- Collection-level computed values

### Communication Patterns

#### `store-reactions.ts`
**Purpose**: Cross-store reactive patterns using SolidJS createEffect  
**Features**:
- DJ flow step → Connection state reactions
- WebRTC status → Error propagation
- Listener states → Connection updates
- Automatic store synchronization
- Error state propagation

#### `store-contexts.tsx`  
**Purpose**: SolidJS context providers for type-safe store access  
**Features**:
- Individual context providers per store
- Composite provider with all stores
- Scoped providers for specific app sections
- Type-safe hooks with helpful error messages
- Context availability utilities

## Usage Patterns

### In Components

```typescript
import { useDJStore, useConnectionStore, useWebRTCStore } from '../stores/store-contexts'

function DJRoom() {
  const djStore = useDJStore()
  const connectionStore = useConnectionStore() 
  const webrtcStore = useWebRTCStore()
  
  // Components only access stores they need
  // Fine-grained reactivity - only re-render when relevant state changes
  const flowStep = djStore.currentFlowStep()
  const isConnected = connectionStore.isConnected()
  const webrtcStatus = webrtcStore.state.status
  
  return (
    <div>
      <p>Flow Step: {flowStep}</p>
      <p>Connected: {isConnected()}</p>
      <p>WebRTC: {webrtcStatus}</p>
    </div>
  )
}
```

### In App.tsx

```typescript
import { StoreProvider } from './stores/store-contexts'

function App() {
  return (
    <StoreProvider>
      <Router>
        <Routes>
          <Route path="/dj/:roomId" component={DJRoom} />
          <Route path="/listen/:roomId" component={ListenerRoom} />
        </Routes>
      </Router>
    </StoreProvider>
  )
}
```

### In Services

Services will be updated to use focused interfaces instead of the monolithic RoomStore:

```typescript
// Before (tightly coupled)
export const publishDJRoom = (roomStore: RoomStore, roomId: string) => { ... }

// After (interface-based, focused)
export const publishDJRoom = (
  dj: DJStateManager,
  connection: ConnectionStateManager, 
  webrtc: WebRTCStatusManager,
  roomId: string
) => { ... }
```

## Migration Status

### ✅ Phase 1: Core Store Creation (COMPLETED)
- [x] Connection store with SolidJS signals
- [x] WebRTC store with SolidJS signals  
- [x] Room metadata store with SolidJS signals
- [x] DJ store with SolidJS signals
- [x] Listeners store with SolidJS signals
- [x] Store reactions with createEffect
- [x] Context providers with type safety

### 🚧 Phase 2: Service Layer Adaptation (NEXT)
- [ ] Create service interface abstractions
- [ ] Create store adapter layer  
- [ ] Update DJ flows service to use adapters
- [ ] Update listener flows service to use adapters
- [ ] Update MediaSoup services to use interfaces

### 🚧 Phase 3: Component Migration  
- [ ] Update App.tsx with new store providers
- [ ] Migrate DJRoom component to use contexts
- [ ] Migrate ListenerRoom component to use contexts
- [ ] Remove roomStore prop passing throughout app
- [ ] Update all components to use specific store hooks

### 🚧 Phase 4: Legacy Cleanup
- [ ] Remove old monolithic room.store.ts
- [ ] Update TypeScript types and interfaces
- [ ] Remove unused imports and references
- [ ] Clean up legacy store patterns

## Files Created

### Core Stores
- `connection.store.ts` - Connection state management
- `webrtc.store.ts` - WebRTC transport status  
- `room-metadata.store.ts` - Room information
- `dj.store.ts` - DJ state with MediaSoup
- `listeners.store.ts` - Listener collection management

### Communication Layer
- `store-reactions.ts` - Cross-store reactive patterns
- `store-contexts.tsx` - SolidJS context providers  

### Documentation
- `README.md` - Architecture documentation

## Performance Improvements

### Before (Monolithic)
- Single 938-line store with all concerns mixed
- Coarse-grained reactivity - any change triggers wide re-renders
- Circular dependencies between domains
- Difficult to optimize specific areas

### After (Domain-Separated)
- 5 focused stores with single responsibilities
- Fine-grained reactivity - only relevant components re-render
- No cross-references - clean separation of concerns
- Easy to optimize specific domains independently

## Type Safety Improvements

### Compile-Time Guarantees
- Context hooks throw errors if used outside providers
- Interface-based service interactions prevent wrong store usage
- Clear API boundaries between domains

### Runtime Safety  
- Store validation helpers
- Consistent error handling patterns
- Graceful degradation when stores unavailable

## Testing Strategy

### Unit Tests
- Each store can be tested in isolation
- Mock interfaces for service testing
- Context provider testing utilities

### Integration Tests
- Store reaction testing
- Cross-store communication validation
- End-to-end flow testing

## Next Steps

1. **Service Adaptation**: Update services to use store interfaces
2. **Component Migration**: Migrate components to use new contexts  
3. **Legacy Removal**: Remove old monolithic store
4. **Performance Validation**: Measure improvement in rendering performance
5. **Documentation**: Update component documentation with new patterns

This architecture provides a solid foundation for scalable, performant, and maintainable state management using SolidJS's native reactivity patterns.