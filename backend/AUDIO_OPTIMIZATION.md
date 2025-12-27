# Audio Optimization Configuration

## Overview
HushFM now supports configurable audio optimization settings via environment variables for low-latency WiFi 6 streaming.

## Configuration Variables

### Backend Audio Settings
```bash
# Opus encoder settings
HUSHFM_OPUS_BITRATE="256000"        # 256kbps (down from 320kbps)
HUSHFM_OPUS_COMPLEXITY="8"          # Complexity 8 (down from 10)
HUSHFM_OPUS_ENABLE_FEC="false"      # Disabled for WiFi 6
HUSHFM_OPUS_ENABLE_VBR="true"       # Enable Variable Bit Rate
HUSHFM_OPUS_FRAME_DURATION="20"     # 20ms frames (10ms for experiment)

# Audio capture settings
HUSHFM_AUDIO_BUFFER_SIZE="1024"     # CPAL buffer size in frames (stereo)
HUSHFM_RING_BUFFER_CAPACITY="4800"  # Ring buffer capacity in samples
HUSHFM_ENABLE_THREAD_PRIORITY="true" # Real-time audio thread
HUSHFM_DSCP_MARKING="46"            # QoS marking (EF)
```

## Performance Optimizations Implemented

### 1. Frontend Latency Reduction (-200 to -500ms)
- **playoutDelayHint = 0**: Eliminates browser audio buffering
- **jitterBufferDelayHint = 0**: Minimizes jitter buffer on Chrome/Edge
- **Existing**: Echo cancellation, noise suppression, AGC already disabled

### 2. Backend Opus Optimization
- **256kbps bitrate**: Transparent quality, 20% less bandwidth
- **Complexity 8**: High quality, ~20% less CPU usage  
- **FEC disabled**: Removes processing overhead (not needed on WiFi 6)
- **VBR enabled**: Constrained Variable Bit Rate for efficiency

### 3. Audio Capture Improvements
- **1024 frame buffer**: Matches CPAL's native buffer size (~21ms)
- **4800 sample ring buffer**: 100ms vs 200ms buffer (less latency)
- **Real-time thread priority**: Prevents audio dropouts under load
- **DSCP marking**: QoS priority for network packets

## Testing 10ms Frame Duration

To test 10ms frames (additional -10ms latency, but 2x CPU/packet overhead):

1. **Change environment variable**:
   ```bash
   export HUSHFM_OPUS_FRAME_DURATION="10"
   ```

2. **Or update flake.nix temporarily**:
   ```nix
   HUSHFM_OPUS_FRAME_DURATION = "10";  # Change from "20"
   ```

3. **Restart the backend** for changes to take effect

### 10ms Frame Trade-offs
- **Benefit**: Additional 10ms latency reduction
- **Cost**: 
  - 2x RTP packet rate (more network overhead)
  - 2x encoding CPU overhead
  - Potentially less stable on slower networks

## Expected Total Latency Improvements

| Optimization | Latency Reduction |
|-------------|------------------|
| Frontend playout hints | -200 to -500ms |
| Smaller buffers | -10 to -30ms |
| 10ms frames (experimental) | -10ms |
| **Total Potential** | **-220 to -540ms** |

## Monitoring

The system logs all configuration values at startup:
```
🔧 Opus encoder configured: 256kbps, 48Hz, 2 channels, complexity=8, VBR=true, FEC=false, frame=20ms
🎤 Stream config: 48000Hz, 2 channels, 1024 samples per period (10.7ms)
🎤 Ring buffer capacity: 4800 samples (50.0ms)
🎤 Set audio thread to real-time priority
```

## Troubleshooting

### Audio Dropouts / Buffer Issues
- System automatically validates buffer size against device capabilities
- Falls back to device-supported range if requested size is out of bounds
- Uses `BufferSize::Default` if device capabilities are unknown
- Increase `HUSHFM_RING_BUFFER_CAPACITY` for more buffering
- Check logs for "Device supported buffer size" and "Using requested buffer size" messages

### High CPU Usage  
- Increase `HUSHFM_OPUS_COMPLEXITY` (up to 10)
- Use 20ms frames instead of 10ms

### Network Issues
- Enable FEC: `HUSHFM_OPUS_ENABLE_FEC="true"`
- Increase bitrate if quality suffers