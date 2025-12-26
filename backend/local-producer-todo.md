To build a robust audio injection system for your Rust backend on a Raspberry Pi (NixOS), I recommend using DirectTransport over PlainTransport. Since your capture (CPAL) and routing (Mediasoup) live in the same process, DirectTransport allows you to pass data via memory without the overhead of local UDP network stacks.
1. High-Level Architecture

This architecture separates the Time-Critical Audio Domain (sync, crash-sensitive) from the Async Network Domain (Tokio, Mediasoup).

text
+-----------------------------------------------------------------------+
|  RUST BACKEND PROCESS (NixOS / Pi 4)                                  |
|                                                                       |
|  [Module: AudioEngine]                                                |
|                                                                       |
|  1. Hardware Capture (cpal)                                           |
|     +-------------------------+                                       |
|     |  Input Device (USB/Pi)  |                                       |
|     +-----------+-------------+                                       |
|                 | (Raw PCM f32)                                       |
|                 v                                                     |
|     +-----------+-------------+       +-----------------------------+ |
|     |   Audio Callback Thread |------>|  Lock-Free Ring Buffer      | |
|     |   (High Priority)       |       |  (heapless::spsc / ringbuf) | |
|     +-------------------------+       +--------------+--------------+ |
|                                                      |                |
|                                                      | (PCM Chunks)   |
|                                                      v                |
|  2. Processing Pipeline (Tokio Task)      +----------+----------+     |
|     +-------------------------+           |  Opus Encoder Task  |     |
|     | Mediasoup Router        |<----------|  (audiopus crate)   |     |
|     | (Worker Thread)         |  (RTP)    +----------+----------+     |
|     +-----------+-------------+                      |                |
|                 ^                                    | (Opus Bytes)   |
|                 | DirectTransport                    v                |
|     +-----------+-------------+           +----------+----------+     |
|     |  DirectProducer         |<----------|  RTP Packetizer     |     |
|     |  (Injects Buffer)       |           |  (rtp crate)        |     |
|     +-------------------------+           +---------------------+     |
|                                                                       |
+-----------------------------------------------------------------------+

2. Recommended Tech Stack

    Audio Capture: cpal. It is the standard for Rust. On NixOS, ensure pipewire and pipewire-alsa are installed so cpal (via ALSA backend) auto-detects the PipeWire default device effortlessly.

​

Encoding: audiopus (bindings for libopus). It requires libopus-dev (or opus in nixpkgs).

Packetization: rtp (part of the webrtc-rs project). It provides structs to easily build valid RTP headers.

Concurrency: ringbuf or crossbeam-queue for passing audio from the sync callback to the async encoder.

Transport: mediasoup::direct_transport::DirectTransport.

    ​

3. Implementation Module: AudioIngest

This module should be self-contained. Your Axum server only calls start() and holds the handle.
Phase 1: Initialization & Device Detection

Instead of hardcoding a device, filter for the system default or a specific hardware signature.

rust
// pseudo-code for automatic detection
fn get_input_config(host: &Host) -> (Device, StreamConfig) {
    // On NixOS/Pipewire, the "default" host usually maps correctly
    let device = host.default_input_device()
        .expect("No input device found");

    // We strictly need 48kHz for Opus compatibility to avoid resampling complexity
    let config = device.supported_input_configs()
        .expect("No configs")
        .find(|c| c.max_sample_rate().0 >= 48000)
        .map(|c| c.with_sample_rate(SampleRate(48000)))
        .expect("Device does not support 48kHz");

    (device, config.into())
}

Phase 2: The Encoder Loop (Async Task)

This task owns the Producer. It reads raw PCM from the ring buffer, encodes it, packetizes it, and pushes it to Mediasoup.

Key Technical Details:

    Opus Frame Size: Opus works best with 20ms frames. At 48kHz, that is 960 samples.

    RTP Timestamp: You must manually increment the RTP timestamp by 960 for every packet sent.

    SSRC: Pick a random generic ID (e.g., 1111) and ensure your Mediasoup Router RtpCodecCapability matches the payload type (e.g., 100).

rust
// Inside your encode loop
let mut timestamp: u32 = 0;
let mut sequence_number: u16 = 0;

loop {
    // 1. Read 960 samples (20ms) from Ring Buffer
    let raw_samples = ring_buffer_consumer.pop_slice(960);

    // 2. Encode to Opus
    let opus_packet = opus_encoder.encode(&raw_samples, &mut output_buf)?;

    // 3. Wrap in RTP (using `rtp` crate)
    let rtp_packet = rtp::packet::Packet {
        header: rtp::header::Header {
            version: 2,
            payload_type: 100, // Must match Router Codec Options
            sequence_number,
            timestamp,
            ssrc: 1111,
            ..Default::default()
        },
        payload: Bytes::copy_from_slice(opus_packet),
    };

    // 4. Send to Mediasoup via DirectProducer
    // Note: direct_producer.send() takes the raw serialized RTP bytes
    let serialized = rtp_packet.marshal()?;
    direct_producer.send(serialized)?;

    timestamp += 960;
    sequence_number = sequence_number.wrapping_add(1);
}

Phase 3: The Audio Callback (Sync Thread)

The cpal callback runs on a high-priority system thread. Do not block here. Do not allocate heap memory here if possible. Just push to the ring buffer.

rust
let stream = device.build_input_stream(
    &config,
    move |data: &[f32], _: &_| {
        // Just push to ring buffer. If full, drop audio (glitch)
        // rather than blocking and crashing the driver.
        ring_buffer_producer.push_slice(data);
    },
    err_fn,
    None
)?;
stream.play()?;

4. Integration with Room Management (Axum)

You can encapsulate this entire lifecycle into a struct that fits your existing system.

rust
pub struct AudioBot {
    // Keep these alive to keep the stream running
    _stream: cpal::Stream,
    _producer: Producer,
    _task: tokio::task::JoinHandle<()>,
}

impl AudioBot {
    pub async fn spawn(
        router: &Router,
        room_id: Uuid // Context for your system
    ) -> Result<Self, AnyError> {

        // 1. Create DirectTransport on the existing Router
        let transport_opts = DirectTransportOptions::default();
        let transport = router.create_direct_transport(transport_opts).await?;

        // 2. Create Producer
        let producer_opts = ProducerOptions::new(
            MediaKind::Audio,
            RtpParameters {
                codecs: vec![RtpCodecParameters {
                    mime_type: MimeTypeAudio::Opus,
                    payload_type: 100,
                    clock_rate: 48000,
                    ..Default::default()
                }],
                ..Default::default()
            },
        );
        let producer = transport.produce(producer_opts).await?;

        // 3. Initialize CPAL and RingBuffer
        let (producer_ring, consumer_ring) = RingBuffer::new(4096);
        let (device, config) = setup_cpal()?;

        // 4. Spawn the translation task (Consumer -> Opus -> RTP -> Producer)
        let producer_clone = producer.clone(); // Producer is cheap to clone/share
        let task = tokio::spawn(async move {
            run_audio_pipeline(consumer_ring, producer_clone).await;
        });

        // 5. Start CPAL Stream
        let stream = start_cpal_stream(device, config, producer_ring)?;

        Ok(Self { _stream: stream, _producer: producer, _task: task })
    }
}

5. Type-Safe Multithreading Tips

    Send + Sync: Ensure your Producer handle is Send. Mediasoup-rs structures usually are.

    Ring Buffer Size: Make it large enough to handle jitter (e.g., 100ms worth of audio), but small enough to keep latency low. 4096 samples at 48kHz is ~85ms.

    Graceful Shutdown: When the AudioBot struct is dropped, the cpal stream will stop automatically. You should implement a Drop trait or a stop() method to abort the Tokio task so it doesn't spin forever waiting for audio that will never come.
