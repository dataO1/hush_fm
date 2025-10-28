#!/usr/bin/env python3
"""
Silent Disco - Entry point
Starts the aiohttp server with all routes configured
"""
import logging
import socket
import ssl
import os
from pathlib import Path
from aiohttp import web

from server.api import (
    serve_index, serve_config, api_identify, api_rooms,
    api_room_create, api_room_join, api_room_close,
    api_lk_token, api_presence
)

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
# Ensure data directory exists
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def create_app() -> web.Application:
    """Create and configure the aiohttp application"""
    app = web.Application()

    # HTML routes
    app.router.add_get("/", serve_index)
    app.router.add_get("/r/{room_id}", serve_index)
    app.router.add_get("/r/{room_id}/", serve_index)

    # API routes
    app.router.add_get("/config", serve_config)
    app.router.add_post("/user/identify", api_identify)
    app.router.add_get("/rooms", api_rooms)
    app.router.add_post("/room/create", api_room_create)
    app.router.add_post("/room/{room_id}/join", api_room_join)
    app.router.add_post("/room/{room_id}/close", api_room_close)
    app.router.add_post("/lk/token", api_lk_token)
    app.router.add_post("/presence/beat", api_presence)

    # Static files
    app.router.add_static('/static', STATIC_DIR)
    logger.info("🎧 Silent Disco server ready • SFU mode • deep links enabled")
    return app

def get_local_ip():
    """Get local WiFi IP address"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "192.168.1.100"

def main():
    app = create_app()
    port = int(os.environ.get("PORT", 3000))
    local_ip = get_local_ip()
    web.run_app(app, host=local_ip, port=port)

if __name__ == "__main__":
    main()
