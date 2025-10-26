#!/usr/bin/env python3
"""
Silent Disco - Entry point
Starts the aiohttp server with all routes configured
"""
import logging
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
STATIC_DIR = THIS_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)


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
    app.router.add_static("/static/", path=str(STATIC_DIR), name="static")

    logger.info("🎧 Silent Disco server ready • SFU mode • deep links enabled")
    return app

def main():
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=3000)

if __name__ == "__main__":
    import ssl
    port = int(os.environ.get("PORT", 3000))

    # Try to use HTTPS if cert exists
    try:
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain('server.crt', 'server.key')
        print(f"🔒 Starting HTTPS server on https://0.0.0.0:{port}")

        # Run aiohttp with SSL
        app = create_app()
        web.run_app(app, host="0.0.0.0", port=port, ssl_context=ssl_context)

    except FileNotFoundError:
        print(f"⚠️  No SSL cert found, starting HTTP server")
        print(f"   Mic access will only work on localhost!")
        print(f"   Generate cert: openssl req -x509 -newkey rsa:4096 -nodes -keyout server.key -out server.crt -days 365 -subj '/CN=192.168.178.79'")

        # Run aiohttp without SSL
        main()
