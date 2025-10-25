# Silent Disco P2P - Complete Architecture

## What Changed

### Server (`main-p2p.py`)
- **REMOVED**: All audio processing (`PausableAudioTrack`, `av` library, aiortc)
- **REMOVED**: File upload/storage endpoints
- **REMOVED**: `/offer` and `/ice-candidate` REST endpoints
- **ADDED**: WebSocket server for real-time signaling
- **KEPT**: Room management, user identification

### Client (`index-p2p.html`)
**DJ Side:**
1. User selects local MP3 file
2. Create `<audio>` element and Web Audio API context
3. Capture audio stream with `createMediaStreamDestination()`
4. Create peer connections to each listener
5. Send SDP offers via WebSocket
6. Stream audio directly to listeners

**Listener Side:**
1. Connect to WebSocket signaling server
2. Receive SDP offer from DJ
3. Create peer connection
4. Send SDP answer back to DJ
5. Receive audio stream directly from DJ's browser

## Architecture Flow

```
DJ Browser:
  [Local MP3 File]
        ↓
  [Web Audio API - Decode]
        ↓
  [MediaStreamDestination - Capture Stream]
        ↓
  [RTCPeerConnection × N listeners]
        ↓
  [WebRTC Direct Audio → Listener 1, 2, 3...]

Server:
  [WebSocket Hub]
        ↓
  [Relay SDP Offers/Answers]
        ↓
  [Relay ICE Candidates]
  (NO AUDIO PROCESSING)

Listener Browser:
  [RTCPeerConnection from DJ]
        ↓
  [Receive Audio Stream]
        ↓
  [<audio> Element Playback]
```

## Key Benefits

✅ **True P2P**: Audio never touches server  
✅ **Scalable**: Server only handles signaling (minimal load)  
✅ **Low Latency**: Direct browser-to-browser connection  
✅ **DJ Control**: DJ's device controls playback  
✅ **No File Upload**: DJ uses local files

## Dependencies Changed

**Server - BEFORE:**
```
aiohttp, aiohttp-cors, aiofiles, aiortc, av, mutagen
```

**Server - AFTER:**
```
aiohttp, aiohttp-cors, aiofiles  # Just web server!
```

**Client:**
- Same browser APIs (Web Audio, WebRTC)
- Added: File input for local MP3 selection

## Installation

```bash
# Server dependencies (much simpler!)
pip install aiohttp aiohttp-cors aiofiles

# No audio processing libraries needed!
```

## Usage

1. Start server: `python main-p2p.py`
2. DJ: Open browser, create room, select local MP3, play
3. Listeners: Join room, receive audio directly from DJ
4. Server only relays WebSocket messages

## Complete Files

I've created `main-p2p.py` (server). Now creating `index-p2p.html` (client) in next response.
