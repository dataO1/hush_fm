#!/usr/bin/env python3
import os
import sys
import json
import asyncio
import logging
import random
import string
from pathlib import Path
from typing import Dict, Optional, Set

from aiohttp import web

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

THIS_DIR = Path(__file__).parent.resolve()
INDEX_FILE = THIS_DIR / "index.html"
STATIC_DIR = THIS_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)  # place simplepeer.min.js here

# In-memory state (signaling only)
rooms: Dict[str, dict] = {}
clients: Dict[str, dict] = {}  # client_id -> { 'ws': WebSocketResponse|None, 'room_id': str|None, 'role': 'dj'|'listener'|None, 'name': str }

def _rand_id(n=9) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "client_" + "".join(random.choice(alphabet) for _ in range(n))

def _room_id() -> str:
    return "".join(random.choice("abcdef0123456789") for _ in range(8))

def _client_name() -> str:
    adjectives = ["Funky", "Groovy", "Electric", "Cosmic", "Disco", "Neon", "Retro", "Stellar", "Jazzy", "Vibrant", "Rhythmic", "Melodic", "Sonic", "Dynamic"]
    nouns = ["Beats", "Rhythm", "Vibes", "Groove", "Tempo", "Harmony", "Sound", "Wave", "Flow", "Pulse", "Chords", "Bass", "Echo", "Dancer"]
    return random.choice(adjectives) + random.choice(nouns) + str(random.randint(1, 99))

async def serve_index(request: web.Request) -> web.StreamResponse:
    return web.FileResponse(INDEX_FILE)

async def serve_config(request: web.Request) -> web.Response:
    # Return only STUN here; add TURN later without changing client logic
    payload = {
        "iceServers": [
            {"urls": "stun:stun.l.google.com:19302"},
            {"urls": "stun:stun1.l.google.com:19302"}
        ]
    }
    return web.json_response(payload)

async def api_identify(request: web.Request) -> web.Response:
    data = await request.json()
    name = data.get("name") or _client_name()
    client_id = _rand_id()
    clients[client_id] = {"ws": None, "room_id": None, "role": None, "name": name}
    logger.info("👤 New user: %s (%s)", name, client_id)
    return web.json_response({"ok": True, "client_id": client_id, "name": name})

async def api_rooms(request: web.Request) -> web.Response:
    items = []
    for rid, r in rooms.items():
        items.append({
            "id": rid,
            "name": r["name"],
            "dj": r.get("dj_client"),
            "listeners": list(r["listeners"])
        })
    return web.json_response({"ok": True, "rooms": items})

async def api_room_create(request: web.Request) -> web.Response:
    data = await request.json()
    client_id = data.get("client_id")
    name = data.get("name") or "My Disco"
    if client_id not in clients:
        return web.json_response({"ok": False, "error": "unknown client"}, status=400)
    rid = _room_id()
    rooms[rid] = {"name": name, "dj_client": None, "listeners": set()}
    logger.info("🎪 Room created: %s by %s (ID: %s)", name, clients[client_id]["name"], rid)
    # Auto-join as DJ
    clients[client_id]["room_id"] = rid
    clients[client_id]["role"] = "dj"
    rooms[rid]["dj_client"] = client_id
    return web.json_response({"ok": True, "room_id": rid})

async def api_room_join(request: web.Request) -> web.Response:
    rid = request.match_info["room_id"]
    data = await request.json()
    client_id = data.get("client_id")
    role = data.get("role")  # 'dj' or 'listener'
    if client_id not in clients:
        return web.json_response({"ok": False, "error": "unknown client"}, status=400)
    if rid not in rooms:
        return web.json_response({"ok": False, "error": "unknown room"}, status=404)

    room = rooms[rid]
    if role == "dj":
        room["dj_client"] = client_id
    else:
        room["listeners"].add(client_id)
    clients[client_id]["room_id"] = rid
    clients[client_id]["role"] = role
    logger.info("✅ %s (%s) joined %s [Client: %s]", clients[client_id]["name"], role, room["name"], client_id)
    return web.json_response({"ok": True})

async def ws_handler(request: web.Request) -> web.StreamResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    # Expect client_id as query param
    client_id = request.query.get("client_id")
    if not client_id or client_id not in clients:
        await ws.close(message=b"unknown client")
        return ws
    clients[client_id]["ws"] = ws
    room_id = clients[client_id].get("room_id")
    role = clients[client_id].get("role")
    logger.info("🔌 New WebSocket connection")

    # If a new listener connects, notify DJ
    if room_id and role == "listener":
        room = rooms.get(room_id)
        dj_id = room.get("dj_client") if room else None
        if dj_id and clients.get(dj_id, {}).get("ws"):
            await clients[dj_id]["ws"].send_json({"type": "new_listener", "listener_id": client_id})
        logger.debug("📡 Broadcast to %s: new_listener (1 clients)", room["name"] if room else room_id)

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            data = json.loads(msg.data)
            msg_type = data.get("type")
            target = data.get("target")
            src = data.get("from")

            # Simple-Peer signaling relay
            if msg_type == "sp-signal":
                if target in clients and clients[target].get("ws"):
                    await clients[target]["ws"].send_json(data)
                    logger.debug("📡 Relayed sp-signal %s → %s bytes=%d", src, target, len(msg.data))
                continue

            # Back-compat (if any old client still sends these)
            if msg_type in ("offer", "answer", "ice-candidate"):
                if target in clients and clients[target].get("ws"):
                    await clients[target]["ws"].send_json(data)
                    logger.debug("📡 Relayed %s %s → %s bytes=%d", msg_type, src, target, len(msg.data))
                continue

    except Exception as e:
        logger.warning("WS error: %r", e)
    finally:
        # Cleanup on disconnect
        if client_id in clients:
            cinfo = clients[client_id]
            rid = cinfo.get("room_id")
            role = cinfo.get("role")
            cinfo["ws"] = None
            if rid and rid in rooms:
                room = rooms[rid]
                if role == "listener" and client_id in room["listeners"]:
                    room["listeners"].discard(client_id)
                    logger.info("🚪 Listener disconnected from %s", room["name"])
                    # Inform DJ
                    dj_id = room.get("dj_client")
                    if dj_id and clients.get(dj_id, {}).get("ws"):
                        await clients[dj_id]["ws"].send_json({"type": "listener_left", "listener_id": client_id})
                        logger.debug("📡 Broadcast to %s: listener_left (1 clients)", room["name"])
                if role == "dj" and room.get("dj_client") == client_id:
                    logger.info("🚪 DJ disconnected, closing room %s", room["name"])
                    # Inform listeners
                    for lid in list(room["listeners"]):
                        if clients.get(lid, {}).get("ws"):
                            await clients[lid]["ws"].send_json({"type": "room_closed"})
                            logger.debug("📡 Broadcast to %s: room_closed (1 clients)", room["name"])
                    del rooms[rid]
        logger.info("🔌 WebSocket closed: %s", client_id)
    return ws

def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", serve_index)
    app.router.add_get("/config", serve_config)
    app.router.add_post("/user/identify", api_identify)
    app.router.add_get("/rooms", api_rooms)
    app.router.add_post("/room/create", api_room_create)
    app.router.add_post("/room/{room_id}/join", api_room_join)
    app.router.add_get("/ws", ws_handler)
    # Serve /static for simplepeer.min.js
    app.router.add_static("/static/", path=str(STATIC_DIR), name="static")
    logger.info("🎧 P2P Silent Disco Server (Signaling Only)")
    logger.info("🚀 P2P Silent Disco (Signaling Server) on http://0.0.0.0:3000")
    logger.info("📡 Pure WebSocket signaling - No audio processing")
    return app

def main():
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=3000)

if __name__ == "__main__":
    main()
