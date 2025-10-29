"""
HTTP API handlers for Silent Disco - OPTIMIZED VERSION
WebSocket support + ETag caching + better error handling
"""
import time
import logging
import os
import hashlib
import json
from pathlib import Path
from aiohttp import web

from .state import rooms, clients, room_update_subscribers
from .utils import generate_client_id, generate_room_id, generate_client_name
from .livekit_auth import mint_livekit_token, is_livekit_configured

logger = logging.getLogger("silent_disco")

THIS_DIR = Path(__file__).parent.parent.resolve()
INDEX_FILE = THIS_DIR / "index.html"

# ============================================================
# WEBSOCKET FOR REAL-TIME UPDATES
# ============================================================

async def ws_room_updates(request):
    """WebSocket endpoint for real-time room list updates"""
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    # Add to subscribers
    room_update_subscribers.add(ws)
    logger.info(f"📡 WebSocket client connected (total: {len(room_update_subscribers)})")

    # Send initial room list
    try:
        rooms_data = await get_rooms_data()
        await ws.send_json({"type": "rooms", "data": rooms_data})
    except Exception as e:
        logger.error(f"Failed to send initial rooms: {e}")

    try:
        async for msg in ws:
            # Handle ping/pong for keepalive
            if msg.type == web.WSMsgType.TEXT:
                if msg.data == "ping":
                    await ws.send_str("pong")
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
    finally:
        room_update_subscribers.discard(ws)
        logger.info(f"📡 WebSocket client disconnected (remaining: {len(room_update_subscribers)})")

    return ws

async def broadcast_room_update():
    """Broadcast room list update to all WebSocket subscribers"""
    if not room_update_subscribers:
        return

    rooms_data = await get_rooms_data()
    message = json.dumps({"type": "rooms", "data": rooms_data})

    dead_sockets = set()
    for ws in room_update_subscribers:
        try:
            await ws.send_str(message)
        except Exception as e:
            logger.debug(f"Failed to send to WebSocket: {e}")
            dead_sockets.add(ws)

    # Remove dead connections
    room_update_subscribers.difference_update(dead_sockets)

# ============================================================
# CONFIGURATION
# ============================================================

async def serve_config(request):
    """Return client configuration with correct LiveKit URL"""
    host = request.host.split(':')[0]
    livekit_port = ":" + str(os.environ.get('LIVEKIT_PORT', '7880'))
    livekit_secure = bool(os.environ.get('LIVEKIT_SECURE', False))
    livekit_protocol = "wss" if livekit_secure else "ws"
    livekit_ws_url = f"{livekit_protocol}://{host}{'/livekit' if livekit_secure else livekit_port}"

    return web.json_response({
        "livekit_ws_url": livekit_ws_url,
        "api_key": os.environ.get('LIVEKIT_API_KEY', 'devkey'),
    })

# ============================================================
# USER IDENTITY
# ============================================================

async def api_identify(request: web.Request) -> web.Response:
    """Create or reuse a client identity"""
    data = await request.json()
    reuse_id = data.get("client_id")

    # Reuse existing client if valid
    if reuse_id and reuse_id in clients:
        client = clients[reuse_id]
        client["last_seen"] = time.time()
        logger.info("♻️ Reusing client_id %s (%s)", reuse_id, client["name"])
        return web.json_response({
            "ok": True,
            "client_id": reuse_id,
            "name": client["name"]
        })

    # Create new client
    name = data.get("name") or generate_client_name()
    client_id = generate_client_id()
    clients[client_id] = {
        "name": name,
        "room_id": None,
        "role": None,
        "last_seen": time.time()
    }
    logger.info("👤 New user: %s (%s)", name, client_id)
    return web.json_response({
        "ok": True,
        "client_id": client_id,
        "name": name
    })

# ============================================================
# ROOM MANAGEMENT
# ============================================================

async def get_rooms_data():
    """Get room list data (used by both HTTP and WebSocket)"""
    now = time.time()
    items = []

    for room_id, room in rooms.items():
        dj_id = room.get("dj_client")
        dj_name = clients.get(dj_id, {}).get("name")
        last_seen_dj = room.get("last_seen_dj")
        dj_online = bool(last_seen_dj and (now - last_seen_dj) < 35.0)

        items.append({
            "id": room_id,
            "name": room.get("name"),
            "dj_client": dj_id,
            "dj_name": dj_name,
            "listener_count": len(room.get("listeners", set())),
            "dj_online": dj_online
        })

    return items

async def api_rooms(request: web.Request) -> web.Response:
    """List all active rooms with ETag caching"""
    items = await get_rooms_data()

    # Generate ETag based on room data
    content = json.dumps(items, sort_keys=True)
    etag = hashlib.md5(content.encode()).hexdigest()

    # Check If-None-Match header
    if request.headers.get("If-None-Match") == etag:
        return web.Response(status=304)

    response = web.json_response({"ok": True, "rooms": items})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "max-age=5"
    return response

async def api_room_create(request: web.Request) -> web.Response:
    """Create a new room or reuse existing room for DJ"""
    data = await request.json()
    client_id = data.get("client_id")
    room_name = data.get("name") or "My Disco"

    if client_id not in clients:
        return web.json_response(
            {"ok": False, "error": "unknown client"},
            status=400
        )

    # Check if DJ already has a room
    for room_id, room in rooms.items():
        if room.get("dj_client") == client_id:
            clients[client_id]["room_id"] = room_id
            clients[client_id]["role"] = "dj"
            logger.info(
                "♻️ Reusing room %s for DJ %s",
                room_id, clients[client_id]["name"]
            )
            return web.json_response({
                "ok": True,
                "room_id": room_id,
                "existing": True
            })

    # Create new room
    room_id = generate_room_id()
    rooms[room_id] = {
        "name": room_name,
        "dj_client": client_id,
        "listeners": set(),
        "last_seen_dj": time.time()
    }
    clients[client_id]["room_id"] = room_id
    clients[client_id]["role"] = "dj"

    logger.info(
        "🎪 Room created: %s by %s (ID: %s)",
        room_name, clients[client_id]["name"], room_id
    )

    # Broadcast update to WebSocket subscribers
    await broadcast_room_update()

    return web.json_response({
        "ok": True,
        "room_id": room_id,
        "existing": False
    })

async def api_room_join(request: web.Request) -> web.Response:
    """Join an existing room as DJ or listener"""
    room_id = request.match_info["room_id"]
    data = await request.json()
    client_id = data.get("client_id")
    role = data.get("role")

    if client_id not in clients:
        return web.json_response(
            {"ok": False, "error": "unknown client"},
            status=400
        )

    if room_id not in rooms:
        return web.json_response(
            {"ok": False, "error": "unknown room"},
            status=404
        )

    room = rooms[room_id]

    # Handle DJ join
    if role == "dj":
        existing_dj = room.get("dj_client")
        if existing_dj not in (None, client_id):
            return web.json_response(
                {"ok": False, "error": "room already has a DJ"},
                status=409
            )
        room["dj_client"] = client_id
        room["last_seen_dj"] = time.time()
    else:
        # Handle listener join
        room["listeners"].add(client_id)

    # Update client state
    clients[client_id]["room_id"] = room_id
    clients[client_id]["role"] = role
    clients[client_id]["last_seen"] = time.time()

    logger.info(
        "✅ %s (%s) joined %s [Client: %s]",
        clients[client_id]["name"], role, room["name"], client_id
    )

    # Broadcast update
    await broadcast_room_update()

    return web.json_response({
        "ok": True,
        "name": room.get("name")
    })

async def api_room_close(request: web.Request) -> web.Response:
    """Close a room (DJ only)"""
    room_id = request.match_info["room_id"]
    data = await request.json()
    client_id = data.get("client_id")

    if room_id not in rooms:
        return web.json_response(
            {"ok": False, "error": "unknown room"},
            status=404
        )

    if client_id not in clients:
        return web.json_response(
            {"ok": False, "error": "unknown client"},
            status=400
        )

    room = rooms[room_id]
    if room.get("dj_client") != client_id:
        return web.json_response(
            {"ok": False, "error": "only DJ can close room"},
            status=403
        )

    del rooms[room_id]
    logger.info("🛑 Room closed: %s by %s", room_id, clients[client_id]["name"])

    # Broadcast update
    await broadcast_room_update()

    return web.json_response({"ok": True})

# ============================================================
# LIVEKIT TOKEN GENERATION
# ============================================================

async def api_lk_token(request: web.Request) -> web.Response:
    """Generate a LiveKit access token for a participant"""
    if not is_livekit_configured():
        return web.json_response(
            {"ok": False, "error": "LIVEKIT_* env variables not configured"},
            status=500
        )

    data = await request.json()
    client_id = data.get("client_id")
    room_id = data.get("room_id")
    role = data.get("role")

    if client_id not in clients:
        return web.json_response(
            {"ok": False, "error": "unknown client"},
            status=400
        )

    if room_id not in rooms:
        return web.json_response(
            {"ok": False, "error": "unknown room"},
            status=404
        )

    token = mint_livekit_token(
        identity=client_id,
        room=room_id,
        role=role,
        name=clients[client_id]["name"]
    )
    host = request.host.split(':')[0]
    livekit_port = ":" + str(os.environ.get('LIVEKIT_PORT', '7880'))
    livekit_secure = bool(os.environ.get('LIVEKIT_SECURE', False))
    livekit_protocol = "wss" if livekit_secure else "ws"
    livekit_ws_url = f"{livekit_protocol}://{host}{'/livekit' if livekit_secure else livekit_port}"

    return web.json_response({
        "ok": True,
        "url": livekit_ws_url,
        "token": token
    })

# ============================================================
# PRESENCE TRACKING (DEPRECATED - use LiveKit events instead)
# ============================================================

async def api_presence(request: web.Request) -> web.Response:
    """Heartbeat endpoint - now optional with LiveKit integration"""
    data = await request.json()
    client_id = data.get("client_id")
    room_id = data.get("room_id")
    role = data.get("role")

    now = time.time()

    if client_id in clients:
        clients[client_id]["last_seen"] = now

    if room_id in rooms and role == "dj":
        rooms[room_id]["last_seen_dj"] = now

    return web.json_response({"ok": True})


async def api_dj_presence(request: web.Request) -> web.Response:
    """
    Update DJ presence based on LiveKit participant events
    Called by frontend when DJ connects/disconnects from LiveKit
    """
    data = await request.json()
    room_id = data.get("room_id")
    dj_client_id = data.get("dj_client_id")
    is_online = data.get("is_online", False)

    if room_id not in rooms:
        return web.json_response(
            {"ok": False, "error": "unknown room"},
            status=404
        )

    room = rooms[room_id]

    if is_online:
        room["last_seen_dj"] = time.time()
    else:
        # DJ disconnected - mark as offline
        room["last_seen_dj"] = 0

    logger.info(f"DJ presence updated: {dj_client_id} in {room_id} - online={is_online}")

    # Broadcast update to WebSocket subscribers
    await broadcast_room_update()

    return web.json_response({"ok": True})
