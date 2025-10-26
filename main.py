#!/usr/bin/env python3
import os
import sys
import json
import time
import logging
import random
import string
from pathlib import Path
from typing import Dict, Optional

from aiohttp import web

try:
    import jwt  # pyjwt
except Exception:
    print("❌ pyjwt is required: pip install pyjwt")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("silent_disco")

THIS_DIR = Path(__file__).parent.resolve()
INDEX_FILE = THIS_DIR / "index.html"
STATIC_DIR = THIS_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

# In-memory state only (no DB persistence)
rooms: Dict[str, dict] = {}     # room_id -> { name, dj_client, listeners:set, last_seen_dj: float|None }
clients: Dict[str, dict] = {}   # client_id -> { name, room_id, role, last_seen }

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
    # Single-page app for / and /r/{room_id}
    return web.FileResponse(INDEX_FILE)

async def serve_config(request: web.Request) -> web.Response:
    # Kept for compatibility; SFU handles ICE internally
    return web.json_response({"iceServers": []})

# Identify supports reuse of client_id to auto-restore sessions
async def api_identify(request: web.Request) -> web.Response:
    data = await request.json()
    reuse_id = data.get("client_id")
    if reuse_id and reuse_id in clients:
        c = clients[reuse_id]
        c["last_seen"] = time.time()
        logger.info("♻️ Reusing client_id %s (%s)", reuse_id, c["name"])
        return web.json_response({"ok": True, "client_id": reuse_id, "name": c["name"]})
    name = data.get("name") or _client_name()
    client_id = _rand_id()
    clients[client_id] = {"name": name, "room_id": None, "role": None, "last_seen": time.time()}
    logger.info("👤 New user: %s (%s)", name, client_id)
    return web.json_response({"ok": True, "client_id": client_id, "name": name})

async def api_rooms(request: web.Request) -> web.Response:
    now = time.time()
    items = []
    for rid, r in rooms.items():
        dj_id = r.get("dj_client")
        dj_name = clients.get(dj_id, {}).get("name")
        last_seen_dj = r.get("last_seen_dj")
        dj_online = bool(last_seen_dj and (now - last_seen_dj) < 35.0)
        items.append({
            "id": rid,
            "name": r.get("name"),
            "dj_client": dj_id,
            "dj_name": dj_name,
            "listener_count": len(r.get("listeners", set())),
            "dj_online": dj_online
        })
    return web.json_response({"ok": True, "rooms": items})

# Enforce: one room per DJ; reuse existing if already created
async def api_room_create(request: web.Request) -> web.Response:
    data = await request.json()
    client_id = data.get("client_id")
    name = data.get("name") or "My Disco"
    if client_id not in clients:
        return web.json_response({"ok": False, "error": "unknown client"}, status=400)
    # Reuse existing room for this DJ
    for rid, r in rooms.items():
        if r.get("dj_client") == client_id:
            clients[client_id]["room_id"] = rid
            clients[client_id]["role"] = "dj"
            logger.info("♻️ Reusing room %s for DJ %s", rid, clients[client_id]["name"])
            return web.json_response({"ok": True, "room_id": rid, "existing": True})
    rid = _room_id()
    rooms[rid] = {"name": name, "dj_client": client_id, "listeners": set(), "last_seen_dj": time.time()}
    clients[client_id]["room_id"] = rid
    clients[client_id]["role"] = "dj"
    logger.info("🎪 Room created: %s by %s (ID: %s)", name, clients[client_id]["name"], rid)
    return web.json_response({"ok": True, "room_id": rid, "existing": False})

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
        # Enforce single DJ per room
        if room.get("dj_client") not in (None, client_id):
            return web.json_response({"ok": False, "error": "room already has a DJ"}, status=409)
        room["dj_client"] = client_id
        room["last_seen_dj"] = time.time()
    else:
        room["listeners"].add(client_id)
    clients[client_id]["room_id"] = rid
    clients[client_id]["role"] = role
    clients[client_id]["last_seen"] = time.time()
    logger.info("✅ %s (%s) joined %s [Client: %s]", clients[client_id]["name"], role, room["name"], client_id)
    return web.json_response({"ok": True})

# LiveKit token minting (self-hosted)
LIVEKIT_URL = os.environ.get("LIVEKIT_WS_URL", "")       # e.g., ws://<LAN_IP>:7880
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")  # e.g., devkey
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")  # e.g., secret

def _mint_livekit_token(identity: str, room: str, role: str, name: Optional[str]) -> str:
    now = int(time.time())
    exp = now + 60 * 60
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
    role = data.get("role")
    if client_id not in clients:
        return web.json_response({"ok": False, "error": "unknown client"}, status=400)
    if room_id not in rooms:
        return web.json_response({"ok": False, "error": "unknown room"}, status=404)
    token = _mint_livekit_token(identity=client_id, room=room_id, role=role, name=clients[client_id]["name"])
    return web.json_response({"ok": True, "url": LIVEKIT_URL, "token": token})

# Lightweight presence to keep room state fresh without DB
async def api_presence(request: web.Request) -> web.Response:
    data = await request.json()
    cid = data.get("client_id")
    rid = data.get("room_id")
    role = data.get("role")
    now = time.time()
    if cid in clients:
        clients[cid]["last_seen"] = now
    if rid in rooms and role == "dj":
        rooms[rid]["last_seen_dj"] = now
    return web.json_response({"ok": True})

def create_app() -> web.Application:
    app = web.Application()
    # SPA entry for root and room deep-links
    app.router.add_get("/", serve_index)
    app.router.add_get("/r/{room_id}", serve_index)
    app.router.add_get("/r/{room_id}/", serve_index)

    app.router.add_get("/config", serve_config)
    app.router.add_post("/user/identify", api_identify)
    app.router.add_get("/rooms", api_rooms)
    app.router.add_post("/room/create", api_room_create)
    app.router.add_post("/room/{room_id}/join", api_room_join)
    app.router.add_post("/lk/token", api_lk_token)
    app.router.add_post("/presence/beat", api_presence)
    app.router.add_static("/static/", path=str(STATIC_DIR), name="static")
    logger.info("🎧 SFU mode ready (LiveKit) — in‑memory rooms; deep links enabled (/r/<roomId>)")
    return app

def main():
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=3000)

if __name__ == "__main__":
    main()
