#!/usr/bin/env python3
import os
import sys
import json
import asyncio
import logging
import random
import string
import time
from pathlib import Path
from typing import Dict, Optional, Set

from aiohttp import web

try:
    import jwt  # pyjwt
except Exception as e:
    print("❌ pyjwt is required: pip install pyjwt")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

THIS_DIR = Path(__file__).parent.resolve()
INDEX_FILE = THIS_DIR / "index.html"
STATIC_DIR = THIS_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

# In-memory state (room list is UX-only; LiveKit enforces room auth internally)
rooms: Dict[str, dict] = {}
clients: Dict[str, dict] = {}  # client_id -> { 'ws': None, 'room_id': str|None, 'role': 'dj'|'listener'|None, 'name': str }

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
    # Client no longer needs ICE here (SFU provides), but keep endpoint stable
    return web.json_response({"iceServers": []})

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
    rooms[rid] = {"name": name, "dj_client": client_id, "listeners": set()}
    clients[client_id]["room_id"] = rid
    clients[client_id]["role"] = "dj"
    logger.info("🎪 Room created: %s by %s (ID: %s)", name, clients[client_id]["name"], rid)
    return web.json_response({"ok": True, "room_id": rid})

async def api_room_join(request: web.Request) -> web.Response:
    rid = request.match_info["room_id"]
    data = await request.json()
    client_id = data.get("client_id")
    role = data.get("role")
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

# LiveKit token minting (SFU)
LIVEKIT_URL = os.environ.get("LIVEKIT_WS_URL", "")  # e.g., wss://<host>:7880
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")

def _mint_livekit_token(identity: str, room: str, role: str, name: Optional[str]) -> str:
    # LiveKit tokens are JWT with "video" grants; sign with API secret
    now = int(time.time())
    exp = now + 60 * 60  # 1h
    grants = {
        "room": room,
        "roomJoin": True,
        "roomCreate": (role == "dj"),
        "canPublish": (role == "dj"),
        "canPublishData": True,
        "canSubscribe": True
    }
    payload = {
        "iss": LIVEKIT_API_KEY,
        "sub": identity,
        "name": name or identity,
        "nbf": now - 5,
        "exp": exp,
        "video": grants
    }
    return jwt.encode(payload, LIVEKIT_API_SECRET, algorithm="HS256")

async def api_lk_token(request: web.Request) -> web.Response:
    if not (LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET):
        return web.json_response({"ok": False, "error": "LIVEKIT_* env missing"}, status=500)
    data = await request.json()
    client_id = data.get("client_id")
    room_id = data.get("room_id")
    role = data.get("role")  # 'dj' or 'listener'
    if not client_id or client_id not in clients:
        return web.json_response({"ok": False, "error": "unknown client"}, status=400)
    if not room_id or room_id not in rooms:
        return web.json_response({"ok": False, "error": "unknown room"}, status=404)
    token = _mint_livekit_token(identity=client_id, room=room_id, role=role, name=clients[client_id]["name"])
    return web.json_response({"ok": True, "url": LIVEKIT_URL, "token": token})

def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", serve_index)
    app.router.add_get("/config", serve_config)
    app.router.add_post("/user/identify", api_identify)
    app.router.add_get("/rooms", api_rooms)
    app.router.add_post("/room/create", api_room_create)
    app.router.add_post("/room/{room_id}/join", api_room_join)
    app.router.add_post("/lk/token", api_lk_token)
    app.router.add_static("/static/", path=str(STATIC_DIR), name="static")
    logger.info("🎧 SFU mode (LiveKit) - token minting enabled")
    logger.info("🔧 Expect LIVEKIT_WS_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET in env")
    return app

def main():
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=3000)

if __name__ == "__main__":
    main()
