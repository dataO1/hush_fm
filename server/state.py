"""
In-memory state management for rooms and clients - OPTIMIZED
Added WebSocket subscriber tracking
"""
from typing import Dict, Set

# Room state: room_id -> {name, dj_client, listeners:set, last_seen_dj:float}
rooms: Dict[str, dict] = {}

# Client state: client_id -> {name, room_id, role, last_seen:float}
clients: Dict[str, dict] = {}

# WebSocket subscribers for room updates
room_update_subscribers: Set = set()
