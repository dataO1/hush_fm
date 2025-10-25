#!/usr/bin/env python3

"""
Silent Disco - TRUE P2P Architecture
Server handles ONLY signaling - DJ browser streams directly to listeners
"""

import os
import sys
import json
import asyncio
import logging
import hashlib
import random
from pathlib import Path
from typing import Dict, Optional, List
from dataclasses import dataclass, field, asdict
from datetime import datetime

try:
    from aiohttp import web
    from aiohttp_cors import setup as cors_setup, ResourceOptions
    import aiofiles
    import aiohttp
except ImportError as e:
    print(f"❌ Required packages not installed: {e}")
    print("Run: pip install aiohttp aiohttp-cors aiofiles")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

ADJECTIVES = ['Funky', 'Groovy', 'Electric', 'Cosmic', 'Disco', 'Neon', 'Retro', 'Stellar',
              'Jazzy', 'Psychedelic', 'Vibrant', 'Rhythmic', 'Melodic', 'Sonic', 'Dynamic']
NOUNS = ['Beats', 'Vibes', 'Dancer', 'Wave', 'Star', 'Sound', 'Echo', 'Dream', 'Soul',
         'Rhythm', 'Flow', 'Pulse', 'Groove', 'Spirit', 'Energy']

def generate_user_id() -> str:
    return hashlib.md5(os.urandom(16)).hexdigest()

def generate_room_id() -> str:
    return hashlib.md5(os.urandom(8)).hexdigest()[:8]

def generate_username() -> str:
    adj = random.choice(ADJECTIVES)
    noun = random.choice(NOUNS)
    num = random.randint(1, 99)
    return f"{adj}{noun}{num}"

@dataclass
class User:
    user_id: str
    username: str
    created_at: float = field(default_factory=lambda: datetime.now().timestamp())
    def to_dict(self): return asdict(self)

@dataclass
class Room:
    room_id: str
    name: str
    dj_user_id: str
    dj_client_id: Optional[str]
    created_at: float
    clients: Dict[str, str] = field(default_factory=dict)  # client_id -> role
    def to_dict(self):
        return {
            'room_id': self.room_id,
            'name': self.name,
            'dj_username': None,
            'listener_count': sum(1 for role in self.clients.values() if role == 'listener'),
            'created_at': self.created_at,
            'is_live': self.dj_client_id is not None
        }

class SilentDiscoServer:
    def __init__(self):
        self.users: Dict[str, User] = {}
        self.rooms: Dict[str, Room] = {}
        self.websockets: Dict[str, web.WebSocketResponse] = {}
        self.client_to_room: Dict[str, str] = {}
        self.client_to_user: Dict[str, str] = {}
        self.pending_messages: Dict[str, List[dict]] = {}

    async def _handle_identify(self, request):
        try:
            data = await request.json()
            existing_user_id = data.get('user_id')
            if existing_user_id and existing_user_id in self.users:
                user = self.users[existing_user_id]
                logger.info(f"🔁 Returning user: {user.username} ({user.user_id[:16]})")
            else:
                user = User(user_id=generate_user_id(), username=generate_username())
                self.users[user.user_id] = user
                logger.info(f"👤 New user: {user.username} ({user.user_id[:16]})")
            return web.json_response({'success': True, 'user': user.to_dict()})
        except Exception as e:
            logger.error(f"Error in identify: {e}")
            return web.json_response({'success': False, 'error': str(e)}, status=400)

    async def _handle_create_room(self, request):
        try:
            data = await request.json()
            user_id = data.get('user_id')
            room_name = data.get('room_name', 'Untitled Room')
            if not user_id or user_id not in self.users:
                return web.json_response({'success': False, 'error': 'Invalid user'}, status=400)
            room_id = generate_room_id()
            room = Room(room_id=room_id, name=room_name, dj_user_id=user_id, dj_client_id=None,
                        created_at=datetime.now().timestamp())
            self.rooms[room_id] = room
            user = self.users[user_id]
            logger.info(f"🎪 Room created: {room_name} by {user.username} (ID: {room_id})")
            room_dict = room.to_dict()
            room_dict['dj_username'] = user.username
            return web.json_response({'success': True, 'room': room_dict})
        except Exception as e:
            logger.error(f"Error creating room: {e}")
            return web.json_response({'success': False, 'error': str(e)}, status=400)

    async def _handle_list_rooms(self, request):
        try:
            rooms_list = []
            for room in self.rooms.values():
                room_dict = room.to_dict()
                dj_user = self.users.get(room.dj_user_id)
                room_dict['dj_username'] = dj_user.username if dj_user else 'Unknown'
                rooms_list.append(room_dict)
            return web.json_response({'success': True, 'rooms': rooms_list})
        except Exception as e:
            logger.error(f"Error listing rooms: {e}")
            return web.json_response({'success': False, 'error': str(e)}, status=400)

    async def _handle_join_room(self, request):
        try:
            room_id = request.match_info['room_id']
            data = await request.json()
            user_id = data.get('user_id')
            role = data.get('role', 'listener')
            client_id = data.get('client_id')
            if not user_id or user_id not in self.users:
                return web.json_response({'success': False, 'error': 'Invalid user'}, status=400)
            if room_id not in self.rooms:
                return web.json_response({'success': False, 'error': 'Room not found'}, status=404)
            room = self.rooms[room_id]
            user = self.users[user_id]
            if role == 'dj' and user_id != room.dj_user_id:
                return web.json_response({'success': False, 'error': 'Not the DJ of this room'}, status=403)

            room.clients[client_id] = role
            self.client_to_room[client_id] = room_id
            self.client_to_user[client_id] = user_id
            if role == 'dj':
                room.dj_client_id = client_id
            logger.info(f"✅ {user.username} ({role}) joined {room.name} [Client: {client_id}]")

            clients_info = []
            for cid, crole in room.clients.items():
                cuser_id = self.client_to_user.get(cid)
                cuser = self.users.get(cuser_id)
                if cuser:
                    clients_info.append({'client_id': cid, 'username': cuser.username, 'role': crole})

            if role == 'listener':
                asyncio.create_task(self._delayed_new_listener_notification(room_id, client_id, user.username))

            return web.json_response({
                'success': True,
                'room_id': room_id,
                'client_id': client_id,
                'role': role,
                'clients': clients_info
            })
        except Exception as e:
            logger.error(f"Error joining room: {e}")
            return web.json_response({'success': False, 'error': str(e)}, status=400)

    async def _delayed_new_listener_notification(self, room_id: str, client_id: str, username: str):
        await asyncio.sleep(0.15)
        await self._broadcast_to_room(room_id, {
            'type': 'new_listener',
            'client_id': client_id,
            'username': username
        }, exclude_client=client_id)

    async def _handle_leave_room(self, request):
        try:
            room_id = request.match_info['room_id']
            data = await request.json()
            client_id = data.get('client_id')
            if room_id not in self.rooms:
                return web.json_response({'success': False, 'error': 'Room not found'}, status=404)
            room = self.rooms[room_id]
            if client_id in room.clients:
                role = room.clients[client_id]
                del room.clients[client_id]
                if client_id in self.client_to_room: del self.client_to_room[client_id]
                if client_id in self.client_to_user: del self.client_to_user[client_id]
                if role == 'dj':
                    logger.info(f"🚪 DJ left, closing room {room.name}")
                    await self._broadcast_to_room(room_id, {'type': 'room_closed'})
                    del self.rooms[room_id]
                else:
                    logger.info(f"🚪 Listener left {room.name}")
                    await self._broadcast_to_room(room_id, {'type': 'listener_left', 'client_id': client_id})
            return web.json_response({'success': True})
        except Exception as e:
            logger.error(f"Error leaving room: {e}")
            return web.json_response({'success': False, 'error': str(e)}, status=400)

    async def _broadcast_to_room(self, room_id: str, message: dict, exclude_client: Optional[str] = None):
        if room_id not in self.rooms: return
        room = self.rooms[room_id]
        message_type = message.get('type', 'unknown')
        sent_count = 0
        for cid in list(room.clients.keys()):
            if cid == exclude_client: continue
            if cid in self.websockets:
                ws = self.websockets[cid]
                try:
                    await ws.send_json(message)
                    sent_count += 1
                except Exception as e:
                    logger.error(f"Failed to send to {cid}: {e}")
        logger.debug(f"📡 Broadcast to {room.name}: {message_type} ({sent_count} clients)")

    async def _handle_websocket(self, request):
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        client_id = None
        logger.info("🔌 New WebSocket connection")
        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    await self._handle_websocket_message(ws, data, client_id)
                    if data.get('type') == 'register' and 'client_id' in data:
                        client_id = data['client_id']
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f'WebSocket error: {ws.exception()}')
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            if client_id:
                await self._handle_client_disconnect(client_id)
                if client_id in self.websockets: del self.websockets[client_id]
                if client_id in self.pending_messages: del self.pending_messages[client_id]
            logger.info(f"🔌 WebSocket closed: {client_id}")
        return ws

    async def _handle_websocket_message(self, ws: web.WebSocketResponse, data: dict, client_id: Optional[str]):
        msg_type = data.get('type')
        try:
            if msg_type == 'register':
                cid = data.get('client_id')
                room_id = data.get('room_id')
                if not cid or not room_id:
                    await ws.send_json({'type': 'error', 'message': 'Missing client_id or room_id'})
                    return
                self.websockets[cid] = ws
                logger.info(f"✅ Client registered: {cid} in room {room_id}")

                if cid in self.pending_messages:
                    pending = self.pending_messages[cid]
                    logger.info(f"📤 Sending {len(pending)} buffered messages to {cid}")
                    for msg in pending: await ws.send_json(msg)
                    del self.pending_messages[cid]

                if room_id in self.rooms:
                    room = self.rooms[room_id]
                    await ws.send_json({'type': 'room_state', 'clients': list(room.clients.keys())})

            elif msg_type in ['offer', 'answer', 'ice-candidate']:
                target_client = data.get('target')
                if target_client and target_client in self.websockets:
                    await self.websockets[target_client].send_json(data)
                    logger.debug(f"📡 Relayed {msg_type} from {client_id} to {target_client}")
                elif target_client:
                    self.pending_messages.setdefault(target_client, []).append(data)
                    logger.debug(f"📦 Buffered {msg_type} for {target_client}")
                else:
                    logger.warning(f"⚠️ No target client specified for {msg_type}")

            elif msg_type in ['seek', 'volume']:
                room_id = self.client_to_room.get(client_id)
                if room_id:
                    await self._broadcast_to_room(room_id, data, exclude_client=client_id)

        except Exception as e:
            logger.error(f"Error handling WebSocket message: {e}")
            await ws.send_json({'type': 'error', 'message': str(e)})

    async def _handle_client_disconnect(self, client_id: str):
        room_id = self.client_to_room.get(client_id)
        if room_id and room_id in self.rooms:
            room = self.rooms[room_id]
            role = room.clients.get(client_id)
            if role == 'dj':
                logger.info(f"🚪 DJ disconnected, closing room {room.name}")
                await self._broadcast_to_room(room_id, {'type': 'room_closed'})
                del self.rooms[room_id]
            else:
                logger.info(f"🚪 Listener disconnected from {room.name}")
                if client_id in room.clients: del room.clients[client_id]
                await self._broadcast_to_room(room_id, {'type': 'listener_left', 'client_id': client_id})
            if client_id in self.client_to_room: del self.client_to_room[client_id]

    async def _serve_index(self, request):
        index_path = Path(__file__).parent / 'index.html'
        if not index_path.exists():
            return web.Response(text="index.html not found", status=404)
        async with aiofiles.open(index_path, 'r') as f:
            content = await f.read()
        return web.Response(text=content, content_type='text/html')

    async def _serve_config(self, request):
        """
        Return ICE servers config.
        Always include STUN; optionally include TURN if env vars are present:
        SD_TURN_URLS (comma-separated), SD_TURN_USERNAME, SD_TURN_CREDENTIAL
        """
        stun = [
            {"urls": "stun:stun.l.google.com:19302"},
            {"urls": "stun:stun1.l.google.com:19302"},
        ]
        ice_servers: List[dict] = list(stun)

        turn_urls = os.getenv("SD_TURN_URLS", "").strip()
        turn_username = os.getenv("SD_TURN_USERNAME", "").strip()
        turn_credential = os.getenv("SD_TURN_CREDENTIAL", "").strip()

        if turn_urls and turn_username and turn_credential:
            urls = [u.strip() for u in turn_urls.split(",") if u.strip()]
            if urls:
                ice_servers.append({
                    "urls": urls,
                    "username": turn_username,
                    "credential": turn_credential
                })
        return web.json_response({"iceServers": ice_servers})

def create_app():
    server = SilentDiscoServer()
    app = web.Application()

    app.router.add_get('/', server._serve_index)
    app.router.add_get('/config', server._serve_config)
    app.router.add_post('/user/identify', server._handle_identify)
    app.router.add_post('/room/create', server._handle_create_room)
    app.router.add_get('/rooms', server._handle_list_rooms)
    app.router.add_post('/room/{room_id}/join', server._handle_join_room)
    app.router.add_post('/room/{room_id}/leave', server._handle_leave_room)
    app.router.add_get('/ws', server._handle_websocket)

    cors = cors_setup(app)
    for route in list(app.router.routes()):
        cors.add(route, {
            "*": ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
                allow_methods="*"
            )
        })
    return app

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Silent Disco P2P Server')
    parser.add_argument('--host', default='0.0.0.0', help='Host to bind to')
    parser.add_argument('--port', type=int, default=3000, help='Port to bind to')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    args = parser.parse_args()
    if args.debug: logging.getLogger().setLevel(logging.DEBUG)
    logger.info("🎧 P2P Silent Disco Server (Signaling Only)")
    logger.info(f"🚀 P2P Silent Disco (Signaling Server) on http://{args.host}:{args.port}")
    logger.info("📡 Pure WebSocket signaling - No audio processing")
    app = create_app()
    web.run_app(app, host=args.host, port=args.port, print=None)

if __name__ == '__main__':
    main()
