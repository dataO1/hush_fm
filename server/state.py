"""
In-memory state management for rooms and clients
"""
from typing import Dict

# Room state: room_id -> {name, dj_client, listeners:set, last_seen_dj:float}
rooms: Dict[str, dict] = {}

# Client state: client_id -> {name, room_id, role, last_seen:float}
clients: Dict[str, dict] = {}
