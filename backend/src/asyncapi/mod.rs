use schemars::schema_for;
use serde_json::Value;

use crate::models::{ClientCommand, ServerEvent, LobbyEvent};

pub mod state_machine;

/// Generate AsyncAPI 3.0 specification manually for maximum compatibility
pub fn generate_asyncapi_spec() -> Result<Value, Box<dyn std::error::Error>> {
    // Generate schemas from Rust types using schemars
    let client_command_schema = schema_for!(ClientCommand);
    let server_event_schema = schema_for!(ServerEvent);
    let lobby_event_schema = schema_for!(LobbyEvent);
    
    let spec = serde_json::json!({
        "asyncapi": "3.0.0",
        "id": "urn:hushfm:websocket:api",
        "info": {
            "title": "HushFM WebSocket API",
            "version": "1.0.0",
            "description": format!(
                "# HushFM Real-time Audio Streaming WebSocket API\n\n\
                HushFM provides live audio streaming over local WiFi networks using WebRTC and WebSocket signaling.\n\n\
                ## Architecture Overview\n\n\
                ```mermaid\n\
                graph TB\n\
                    DJ[DJ Client] --> |WebSocket| RoomWS[Room WebSocket]\n\
                    Listener[Listener Client] --> |WebSocket| LobbyWS[Lobby WebSocket]\n\
                    Listener --> |WebSocket| RoomWS\n\
                    \n\
                    RoomWS --> |WebRTC Signaling| Producer[Audio Producer]\n\
                    Producer --> |RTP| Consumer[Audio Consumer]\n\
                    Consumer --> |Audio Stream| Listener\n\
                    \n\
                    LobbyWS --> |Room Updates| AllClients[All Lobby Clients]\n\
                ```\n\n\
                ## WebSocket Channels\n\n\
                ### 1. Lobby Channel (`/ws/lobby`)\n\
                - **Purpose**: Room discovery and real-time room list updates\n\
                - **Clients**: All users browsing available rooms\n\
                - **Events**: Room added/updated/removed notifications\n\n\
                ### 2. Room Channel (`/ws/room/{{roomId}}`)\n\
                - **Purpose**: Room-specific communication for DJs and listeners\n\
                - **Clients**: DJ and listeners in a specific room\n\
                - **Commands**: WebRTC signaling, stream control, room management\n\n\
                ## State Machine\n\n\
                {}\n\n\
                ## Connection Flow\n\n\
                1. **DJ Flow**: Create room → Connect transport → Produce audio → Room becomes public\n\
                2. **Listener Flow**: Browse lobby → Join room → Connect transport → Consume audio\n\n\
                ## Local Network Optimization\n\n\
                - WebRTC configured for local WiFi without STUN/TURN servers\n\
                - Empty ICE candidates for direct peer connection\n\
                - DTLS security maintained for encrypted communication",
                state_machine::generate_state_diagram()
            ),
            "license": {
                "name": "MIT"
            }
        },
        "defaultContentType": "application/json",
        "servers": {
            "development": {
                "host": "localhost:3000",
                "protocol": "ws",
                "description": "Development server for local testing"
            },
            "production": {
                "host": "{host}:3000",
                "protocol": "ws", 
                "description": "Production server on local network",
                "variables": {
                    "host": {
                        "description": "Local network IP address",
                        "default": "192.168.1.100",
                        "examples": ["192.168.1.100", "10.0.1.100"]
                    }
                }
            }
        },
        "channels": {
            "lobby": {
                "address": "/ws/lobby",
                "title": "Lobby Channel",
                "description": "Subscribe to this channel to receive real-time notifications about room changes. All clients browsing the room list should connect to this channel.",
                "messages": {
                    "LobbyEvent": {
                        "$ref": "#/components/messages/LobbyEvent"
                    }
                },
                "bindings": {
                    "ws": {
                        "method": "GET",
                        "bindingVersion": "0.1.0"
                    }
                }
            },
            "room": {
                "address": "/ws/room/{roomId}",
                "title": "Room Channel",
                "description": "Bidirectional communication channel for a specific room. DJs use this for stream control and WebRTC signaling. Listeners use this for consuming audio streams.",
                "parameters": {
                    "roomId": {
                        "description": "Unique room identifier",
                        "schema": {
                            "type": "string",
                            "format": "uuid",
                            "example": "123e4567-e89b-12d3-a456-426614174000"
                        }
                    }
                },
                "messages": {
                    "ClientCommand": {
                        "$ref": "#/components/messages/ClientCommand"
                    },
                    "ServerEvent": {
                        "$ref": "#/components/messages/ServerEvent"
                    }
                },
                "bindings": {
                    "ws": {
                        "method": "GET",
                        "bindingVersion": "0.1.0"
                    }
                }
            }
        },
        "operations": {
            "subscribeLobbyEvents": {
                "action": "receive",
                "channel": {
                    "$ref": "#/channels/lobby"
                },
                "title": "Subscribe to Lobby Events",
                "description": "Subscribe to real-time room list updates",
                "messages": [
                    { "$ref": "#/components/messages/LobbyEvent" }
                ],
                "tags": [
                    { "name": "Real-time" }
                ]
            },
            "sendRoomCommand": {
                "action": "send",
                "channel": {
                    "$ref": "#/channels/room"
                },
                "title": "Send Room Command",
                "description": "Send WebRTC signaling and stream control commands",
                "messages": [
                    { "$ref": "#/components/messages/ClientCommand" }
                ],
                "tags": [
                    { "name": "WebRTC" },
                    { "name": "Commands" }
                ]
            },
            "receiveRoomEvents": {
                "action": "receive",
                "channel": {
                    "$ref": "#/channels/room"
                },
                "title": "Receive Room Events", 
                "description": "Receive WebRTC signaling responses and stream events",
                "messages": [
                    { "$ref": "#/components/messages/ServerEvent" }
                ],
                "tags": [
                    { "name": "WebRTC" },
                    { "name": "Events" }
                ]
            }
        },
        "components": {
            "messages": {
                "ClientCommand": {
                    "name": "ClientCommand",
                    "title": "Client Command",
                    "summary": "Commands sent from client to server",
                    "description": "All commands that clients can send to the server for WebRTC signaling and stream control. Commands include transport connection, media production, stream control, and room management.",
                    "tags": [
                        { "name": "WebRTC" },
                        { "name": "Commands" }
                    ],
                    "payload": client_command_schema,
                    "examples": [
                        {
                            "name": "ConnectTransport",
                            "summary": "Connect WebRTC transport",
                            "description": "Establish DTLS connection for WebRTC transport",
                            "payload": {
                                "type": "connectTransport",
                                "dtlsParameters": {
                                    "role": "client",
                                    "fingerprints": [{
                                        "algorithm": "sha-256",
                                        "value": "FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF:FF"
                                    }]
                                },
                                "_traceContext": {
                                    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
                                }
                            }
                        },
                        {
                            "name": "JoinRoom",
                            "summary": "Join a room as listener",
                            "description": "Connect to an existing room to listen to the stream",
                            "payload": {
                                "type": "joinRoom",
                                "roomId": "123e4567-e89b-12d3-a456-426614174000",
                                "_traceContext": {
                                    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
                                }
                            }
                        },
                        {
                            "name": "PauseStream",
                            "summary": "Pause audio stream",
                            "description": "DJ pauses their audio stream (mute microphone)",
                            "payload": {
                                "type": "pauseStream",
                                "_traceContext": {
                                    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
                                }
                            }
                        }
                    ]
                },
                "ServerEvent": {
                    "name": "ServerEvent",
                    "title": "Server Event",
                    "summary": "Events sent from server to client",
                    "description": "All events that the server sends to clients in response to commands or state changes. Events include transport status, media production status, stream state, and error notifications.",
                    "tags": [
                        { "name": "WebRTC" },
                        { "name": "Events" }
                    ],
                    "payload": server_event_schema,
                    "examples": [
                        {
                            "name": "TransportReady",
                            "summary": "WebRTC transport ready",
                            "description": "Transport has been created and is ready for connection",
                            "payload": {
                                "type": "transportReady",
                                "transportId": "transport-123",
                                "_traceContext": {
                                    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
                                }
                            }
                        },
                        {
                            "name": "ProducerCreated",
                            "summary": "Audio producer created",
                            "description": "DJ's audio producer has been created, room is now live",
                            "payload": {
                                "type": "producerCreated",
                                "producerId": "producer-456",
                                "roomId": "123e4567-e89b-12d3-a456-426614174000",
                                "_traceContext": {
                                    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
                                }
                            }
                        },
                        {
                            "name": "StreamPaused",
                            "summary": "Stream paused by DJ",
                            "description": "DJ has paused their audio stream",
                            "payload": {
                                "type": "streamPaused",
                                "roomId": "123e4567-e89b-12d3-a456-426614174000",
                                "_traceContext": {
                                    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
                                }
                            }
                        }
                    ]
                },
                "LobbyEvent": {
                    "name": "LobbyEvent",
                    "title": "Lobby Event",
                    "summary": "Events broadcast to lobby clients",
                    "description": "Events broadcast to all clients connected to the lobby channel about room changes. Includes room creation, updates, and removal notifications.",
                    "tags": [
                        { "name": "Real-time" },
                        { "name": "Broadcast" }
                    ],
                    "payload": lobby_event_schema,
                    "examples": [
                        {
                            "name": "RoomAdded",
                            "summary": "New room available",
                            "description": "A new room has been created and is available for listeners",
                            "payload": {
                                "type": "roomAdded",
                                "room": {
                                    "id": "123e4567-e89b-12d3-a456-426614174000",
                                    "name": "DJ Session",
                                    "djName": "DJ Example",
                                    "listenerCount": 3,
                                    "isStreaming": true,
                                    "createdAt": "2025-12-07T14:30:00Z",
                                    "tags": ["electronic", "live"]
                                },
                                "_traceContext": {
                                    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
                                }
                            }
                        },
                        {
                            "name": "RoomRemoved", 
                            "summary": "Room no longer available",
                            "description": "Room has been closed by DJ",
                            "payload": {
                                "type": "roomRemoved",
                                "roomId": "123e4567-e89b-12d3-a456-426614174000",
                                "_traceContext": {
                                    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
                                }
                            }
                        }
                    ]
                }
            },
            "schemas": {
                "ClientCommand": client_command_schema,
                "ServerEvent": server_event_schema,
                "LobbyEvent": lobby_event_schema,
                "TraceContext": {
                    "type": "object",
                    "description": "W3C Trace Context for distributed tracing",
                    "properties": {
                        "traceparent": {
                            "type": "string",
                            "description": "W3C traceparent header value",
                            "pattern": "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
                            "example": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
                        },
                        "tracestate": {
                            "type": "string",
                            "description": "W3C tracestate header value (optional)",
                            "example": "congo=t61rcWkgMzE"
                        }
                    },
                    "required": ["traceparent"]
                }
            }
        }
    });
    
    Ok(spec)
}

/// Serialize the AsyncAPI spec to YAML
pub fn serialize_to_yaml(spec: &Value) -> Result<String, Box<dyn std::error::Error>> {
    Ok(serde_yaml::to_string(spec)?)
}

/// Serialize the AsyncAPI spec to JSON  
pub fn serialize_to_json(spec: &Value) -> Result<String, Box<dyn std::error::Error>> {
    Ok(serde_json::to_string_pretty(spec)?)
}