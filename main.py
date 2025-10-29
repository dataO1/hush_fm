#!/usr/bin/env python3
"""
Silent Disco - Optimized Entry Point
WebSocket support + rate limiting + cleanup tasks
"""
import logging
import socket
import ssl
import os
import asyncio
import time
from pathlib import Path
from aiohttp import web
from collections import defaultdict

from server.api import (
    serve_config, api_identify, api_rooms,
    api_room_create, api_room_join, api_room_close,
    api_lk_token, api_presence, ws_room_updates, api_dj_presence
)
from server.state import rooms, clients

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("silent_disco")

THIS_DIR = Path(__file__).parent.resolve()
STATIC_DIR = Path(os.getenv('HUSH_STATIC_DIR', './static'))
SERVER_DIR = Path(os.getenv('HUSH_SERVER_DIR', './server'))
DATA_DIR = Path(os.getenv('HUSH_DATA_DIR', './data'))
UPLOADS_DIR = DATA_DIR / 'uploads'
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Rate limiting storage
rate_limit_store = defaultdict(list)

async def index(request):
    return web.FileResponse(STATIC_DIR / 'index.html')

@web.middleware
async def rate_limit_middleware(request, handler):
    """Simple rate limiting: 100 requests per minute per IP"""
    ip = request.remote
    now = time.time()
    path = request.path

    # Skip rate limiting for static assets
    if path.startswith('/static'):
        return await handler(request)

    # Clean old entries
    rate_limit_store[ip] = [t for t in rate_limit_store[ip] if now - t < 60]

    # Check limit
    if len(rate_limit_store[ip]) > 100:
        logger.warning(f"Rate limit exceeded for {ip}")
        return web.json_response(
            {"ok": False, "error": "Rate limit exceeded"},
            status=429
        )

    rate_limit_store[ip].append(now)
    return await handler(request)

# async def cleanup_stale_data(app):
#     """Background task to cleanup stale clients and rooms"""
#     while True:
#         try:
#             await asyncio.sleep(60)  # Run every minute
#             now = time.time()
#
#             # Remove stale clients (inactive > 2 minutes)
#             stale_clients = [
#                 cid for cid, client in clients.items()
#                 if now - client.get("last_seen", 0) > 120
#             ]
#             for cid in stale_clients:
#                 logger.info(f"🧹 Removing stale client: {cid}")
#                 del clients[cid]
#
#             # Remove rooms with no DJ for > 5 minutes
#             stale_rooms = []
#             for rid, room in rooms.items():
#                 last_seen_dj = room.get("last_seen_dj", 0)
#                 if now - last_seen_dj > 300:
#                     stale_rooms.append(rid)
#
#             for rid in stale_rooms:
#                 logger.info(f"🧹 Removing stale room: {rid}")
#                 del rooms[rid]
#
#         except Exception as e:
#             logger.error(f"Cleanup task error: {e}")

def create_app() -> web.Application:
    """Create and configure the aiohttp application"""
    app = web.Application(middlewares=[rate_limit_middleware])

    # HTML routes
    app.router.add_get("/", index)
    app.router.add_get("/r/{room_id}", index)
    app.router.add_get("/r/{room_id}/", index)

    # API routes
    app.router.add_get("/config", serve_config)
    app.router.add_post("/user/identify", api_identify)
    app.router.add_get("/rooms", api_rooms)
    app.router.add_post("/room/create", api_room_create)
    app.router.add_post("/room/{room_id}/join", api_room_join)
    app.router.add_post("/room/{room_id}/close", api_room_close)
    app.router.add_post("/lk/token", api_lk_token)
    app.router.add_post("/presence/beat", api_presence)
    app.router.add_post("/presence/dj-status", api_dj_presence)

    # WebSocket for real-time room updates
    app.router.add_get("/ws/rooms", ws_room_updates)

    # Static files
    app.router.add_static('/static', STATIC_DIR, name='static')

    # Start cleanup task

    # app.on_startup.append(start_background_tasks)
    logger.info("🎧 Silent Disco server ready • Optimized • WebSocket enabled")
    return app

# async def start_background_tasks(app):
#     app['cleanup_task'] = asyncio.create_task(cleanup_stale_data(app))

def get_local_ip():
    """Get local WiFi IP address"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"

def main():
    app = create_app()
    port = int(os.environ.get("PORT", 3000))
    host = os.environ.get("SERVER_HOST", "0.0.0.0")
    local_ip = get_local_ip()

    logger.info(f"🚀 Starting server on {host}:{port}")
    logger.info(f"💡 Access at: http://{local_ip}:{port}")

    web.run_app(app, host=host, port=port)

if __name__ == "__main__":
    main()
