"""
HTTP API handlers for Silent Disco
"""
import time
import logging
from pathlib import Path
from aiohttp import web

from .state import rooms, clients
from .utils import generate_client_id, generate_room_id, generate_client_name
from .livekit_auth import mint_livekit_token, is_livekit_configured


logger = logging.getLogger("silent_disco")

THIS_DIR = Path(__file__).parent.parent.resolve()
INDEX_FILE = THIS_DIR / "index.html"


# ============================================================
# HTML SERVING
# ============================================================

async def serve_index(request: web.Request) -> web.StreamResponse:
    """Serve the main HTML page (SPA entry point)"""
    return web.FileResponse(INDEX_FILE)


async def serve_config(request: web.Request) -> web.Response:
    """Serve empty ICE config (LiveKit handles ICE internally)"""
    return web.json_response({"iceServers": []})


# ============================================================
# USER IDENTITY
# ============================================================

async def api_identify(request: web.Request) -> web.Response:
    """
    Create or reuse a client identity
    Supports client_id reuse via localStorage
    """
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

async def api_rooms(request: web.Request) -> web.Response:
    """List all active rooms with metadata"""
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

    return web.json_response({"ok": True, "rooms": items})


async def api_room_create(request: web.Request) -> web.Response:
    """
    Create a new room or reuse existing room for DJ
    One DJ can only have one active room
    """
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

    # Handle DJ join (only one DJ per room)
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

    from .livekit_auth import LIVEKIT_URL
    return web.json_response({
        "ok": True,
        "url": LIVEKIT_URL,
        "token": token
    })


# ============================================================
# PRESENCE TRACKING
# ============================================================

async def api_presence(request: web.Request) -> web.Response:
    """
    Heartbeat endpoint to track online status
    Clients should ping this every ~15 seconds
    """
    data = await request.json()
    client_id = data.get("client_id")
    room_id = data.get("room_id")
    role = data.get("role")

    now = time.time()

    # Update client last seen
    if client_id in clients:
        clients[client_id]["last_seen"] = now

    # Update DJ last seen in room
    if room_id in rooms and role == "dj":
        rooms[room_id]["last_seen_dj"] = now

    return web.json_response({"ok": True})
