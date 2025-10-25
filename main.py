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
from typing import Dict, Set, Optional
from dataclasses import dataclass, field, asdict
from datetime import datetime

try:
    from aiohttp import web
    from aiohttp_cors import setup as cors_setup
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
NOUNS = ['Beats', 'Vibes', 'Dancer', 'DJ', 'Star', 'Wave', 'Soul', 'Spirit', 
         'Phoenix', 'Tiger', 'Dragon', 'Panther', 'Eagle', 'Wolf', 'Fox']


def generate_nickname() -> str:
    adj = random.choice(ADJECTIVES)
    noun = random.choice(NOUNS)
    num = random.randint(10, 99)
    return f"{adj}{noun}{num}"


def generate_fingerprint(request: web.Request) -> str:
    components = [
        request.headers.get('User-Agent', ''),
        request.headers.get('Accept-Language', ''),
        request.headers.get('Accept-Encoding', ''),
        request.remote or ''
    ]
    fingerprint_str = '|'.join(components)
    return hashlib.sha256(fingerprint_str.encode()).hexdigest()[:16]


@dataclass
class User:
    fingerprint: str
    nickname: str
    created_at: str
    room_id: Optional[str] = None
    
    def to_dict(self) -> dict:
        return {
            'fingerprint': self.fingerprint,
            'nickname': self.nickname,
            'created_at': self.created_at,
            'room_id': self.room_id
        }


@dataclass
class Client:
    client_id: str
    user_fingerprint: str
    role: str  # 'dj' or 'listener'
    room_id: str
    connected_at: str
    websocket: Optional[aiohttp.web.WebSocketResponse] = None
    
    def to_dict(self) -> dict:
        return {
            'client_id': self.client_id,
            'user_fingerprint': self.user_fingerprint,
            'role': self.role,
            'room_id': self.room_id,
            'connected_at': self.connected_at
        }


@dataclass
class Room:
    id: str
    name: str
    dj_fingerprint: str
    dj_nickname: str
    created_at: str
    max_capacity: int = 50
    dj_client_id: Optional[str] = None  # Track which client is DJ
    connected_clients: Dict[str, Client] = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'dj_nickname': self.dj_nickname,
            'created_at': self.created_at,
            'max_capacity': self.max_capacity,
            'connected_clients': len(self.connected_clients),
            'listener_count': len([c for c in self.connected_clients.values() if c.role == 'listener']),
            'capacity_remaining': self.max_capacity - len(self.connected_clients),
            'dj_online': self.dj_client_id is not None
        }


class SilentDiscoP2PServer:
    """
    Pure signaling server for P2P audio streaming
    - No audio processing
    - No file uploads
    - Only WebSocket signaling for WebRTC
    """
    
    def __init__(self, host: str = "0.0.0.0", port: int = 3000):
        self.host = host
        self.port = port
        self.app = web.Application()
        
        # Data structures
        self.users: Dict[str, User] = {}
        self.rooms: Dict[str, Room] = {}
        self.clients: Dict[str, Client] = {}  # client_id -> Client
        
        self._setup_routes()
        cors_setup(self.app)
        logger.info("🎧 P2P Silent Disco Server (Signaling Only)")
    
    def _setup_routes(self) -> None:
        # Static files
        self.app.router.add_get('/', self._handle_index)
        self.app.router.add_get('/room/{room_id}', self._handle_room_url)
        self.app.router.add_static('/static', path=Path('static'), name='static')
        
        # User management
        self.app.router.add_post('/user/identify', self._handle_identify_user)
        
        # Room management
        self.app.router.add_get('/rooms', self._handle_get_rooms)
        self.app.router.add_post('/room/create', self._handle_create_room)
        self.app.router.add_get('/api/room/{room_id}', self._handle_get_room)
        self.app.router.add_post('/room/{room_id}/join', self._handle_join_room)
        self.app.router.add_post('/room/{room_id}/leave', self._handle_leave_room)
        self.app.router.add_delete('/room/{room_id}', self._handle_delete_room)
        
        # WebSocket signaling
        self.app.router.add_get('/ws', self._handle_websocket)
        
        # Health check
        self.app.router.add_get('/health', self._handle_health)
    
    async def _broadcast_to_room(self, room_id: str, message: dict, exclude_client: Optional[str] = None):
        """Send message to all clients in room via WebSocket"""
        room = self.rooms.get(room_id)
        if not room:
            return
        
        sent_count = 0
        for client_id, client in room.connected_clients.items():
            if client_id == exclude_client:
                continue
            
            if client.websocket and not client.websocket.closed:
                try:
                    await client.websocket.send_json(message)
                    sent_count += 1
                except Exception as e:
                    logger.error(f"❌ Broadcast error to {client_id}: {e}")
        
        if sent_count > 0:
            logger.debug(f"📡 Broadcast to {room.name}: {message.get('type')} ({sent_count} clients)")
    
    async def _handle_index(self, request: web.Request) -> web.Response:
        index_path = Path('static/index.html')
        if index_path.exists():
            async with aiofiles.open(index_path, 'r') as f:
                content = await f.read()
                return web.Response(text=content, content_type='text/html')
        return web.Response(text='Silent Disco P2P Server', status=200)
    
    async def _handle_room_url(self, request: web.Request) -> web.Response:
        return await self._handle_index(request)
    
    async def _handle_identify_user(self, request: web.Request) -> web.Response:
        try:
            fingerprint = generate_fingerprint(request)
            
            if fingerprint not in self.users:
                nickname = generate_nickname()
                user = User(
                    fingerprint=fingerprint,
                    nickname=nickname,
                    created_at=datetime.now().isoformat()
                )
                self.users[fingerprint] = user
                logger.info(f"👤 New user: {nickname} ({fingerprint})")
            else:
                user = self.users[fingerprint]
            
            return web.json_response({
                'success': True,
                'user': user.to_dict()
            })
        
        except Exception as e:
            logger.error(f"❌ Identify error: {e}")
            return web.json_response({'error': str(e)}, status=500)
    
    async def _handle_get_rooms(self, request: web.Request) -> web.Response:
        rooms = [room.to_dict() for room in self.rooms.values()]
        return web.json_response({'rooms': rooms, 'total': len(rooms)})
    
    async def _handle_create_room(self, request: web.Request) -> web.Response:
        try:
            data = await request.json()
            room_name = data.get('name', '').strip()
            user_fingerprint = generate_fingerprint(request)
            
            if not room_name:
                return web.json_response({'error': 'Room name required'}, status=400)
            
            if user_fingerprint not in self.users:
                return web.json_response({'error': 'User not identified'}, status=401)
            
            user = self.users[user_fingerprint]
            
            if user.room_id:
                return web.json_response({'error': 'You already created a room'}, status=400)
            
            import uuid
            room_id = str(uuid.uuid4())[:8]
            room = Room(
                id=room_id,
                name=room_name,
                dj_fingerprint=user_fingerprint,
                dj_nickname=user.nickname,
                created_at=datetime.now().isoformat()
            )
            
            self.rooms[room_id] = room
            user.room_id = room_id
            
            logger.info(f"🎪 Room created: {room_name} by {user.nickname} (ID: {room_id})")
            
            return web.json_response({
                'success': True,
                'room': room.to_dict()
            })
        
        except Exception as e:
            logger.error(f"❌ Create room error: {e}")
            return web.json_response({'error': str(e)}, status=500)
    
    async def _handle_get_room(self, request: web.Request) -> web.Response:
        room_id = request.match_info['room_id']
        room = self.rooms.get(room_id)
        
        if not room:
            return web.json_response({'error': 'Room not found'}, status=404)
        
        return web.json_response(room.to_dict())
    
    async def _handle_join_room(self, request: web.Request) -> web.Response:
        try:
            room_id = request.match_info['room_id']
            data = await request.json()
            client_id = data.get('client_id')
            user_fingerprint = generate_fingerprint(request)
            
            room = self.rooms.get(room_id)
            if not room:
                return web.json_response({'error': 'Room not found'}, status=404)
            
            if len(room.connected_clients) >= room.max_capacity:
                return web.json_response({'error': 'Room is full'}, status=400)
            
            role = 'dj' if user_fingerprint == room.dj_fingerprint else 'listener'
            
            client = Client(
                client_id=client_id,
                user_fingerprint=user_fingerprint,
                role=role,
                room_id=room_id,
                connected_at=datetime.now().isoformat()
            )
            
            room.connected_clients[client_id] = client
            self.clients[client_id] = client
            
            if role == 'dj':
                room.dj_client_id = client_id
            
            user = self.users.get(user_fingerprint)
            nickname = user.nickname if user else 'Anonymous'
            
            logger.info(f"✅ {nickname} ({role}) joined {room.name} [Client: {client_id}]")
            
            return web.json_response({
                'success': True,
                'room': room.to_dict(),
                'role': role,
                'nickname': nickname
            })
        
        except Exception as e:
            logger.error(f"❌ Join error: {e}")
            return web.json_response({'error': str(e)}, status=500)
    
    async def _handle_leave_room(self, request: web.Request) -> web.Response:
        try:
            room_id = request.match_info['room_id']
            data = await request.json()
            client_id = data.get('client_id')
            
            room = self.rooms.get(room_id)
            if room and client_id in room.connected_clients:
                client = room.connected_clients[client_id]
                del room.connected_clients[client_id]
                
                if client.role == 'dj':
                    room.dj_client_id = None
                
                logger.info(f"🔌 Client left: {client_id} from {room.name}")
                
                # Notify remaining clients
                await self._broadcast_to_room(room_id, {
                    'type': 'client_left',
                    'client_id': client_id,
                    'listener_count': len([c for c in room.connected_clients.values() if c.role == 'listener'])
                })
            
            if client_id in self.clients:
                del self.clients[client_id]
            
            return web.json_response({'success': True})
        
        except Exception as e:
            logger.error(f"❌ Leave error: {e}")
            return web.json_response({'error': str(e)}, status=500)
    
    async def _handle_delete_room(self, request: web.Request) -> web.Response:
        try:
            room_id = request.match_info['room_id']
            user_fingerprint = generate_fingerprint(request)
            
            room = self.rooms.get(room_id)
            if not room:
                return web.json_response({'error': 'Room not found'}, status=404)
            
            if room.dj_fingerprint != user_fingerprint:
                return web.json_response({'error': 'Only DJ can delete room'}, status=403)
            
            # Notify all clients room is closing
            await self._broadcast_to_room(room_id, {'type': 'room_closed'})
            
            # Close all WebSockets
            for client in room.connected_clients.values():
                if client.websocket and not client.websocket.closed:
                    await client.websocket.close()
            
            if user_fingerprint in self.users:
                self.users[user_fingerprint].room_id = None
            
            del self.rooms[room_id]
            logger.info(f"🗑️  Room deleted: {room.name}")
            
            return web.json_response({'success': True})
        
        except Exception as e:
            logger.error(f"❌ Delete room error: {e}")
            return web.json_response({'error': str(e)}, status=500)
    
    async def _handle_websocket(self, request: web.Request) -> web.WebSocketResponse:
        """
        WebSocket signaling channel for P2P connections
        Relays SDP offers/answers and ICE candidates between peers
        """
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        
        client_id = None
        logger.info("🔌 New WebSocket connection")
        
        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        msg_type = data.get('type')
                        
                        # Client registration
                        if msg_type == 'register':
                            client_id = data.get('client_id')
                            room_id = data.get('room_id')
                            
                            if client_id and client_id in self.clients:
                                self.clients[client_id].websocket = ws
                                logger.info(f"✅ Client registered: {client_id} in room {room_id}")
                                
                                # Send current room state
                                room = self.rooms.get(room_id)
                                if room:
                                    await ws.send_json({
                                        'type': 'room_state',
                                        'listener_count': len([c for c in room.connected_clients.values() if c.role == 'listener']),
                                        'dj_client_id': room.dj_client_id,
                                        'clients': list(room.connected_clients.keys())
                                    })
                        
                        # WebRTC signaling - relay to specific peer
                        elif msg_type in ['offer', 'answer', 'ice-candidate']:
                            target_id = data.get('target')
                            from_id = data.get('from')
                            
                            if target_id and target_id in self.clients:
                                target_client = self.clients[target_id]
                                if target_client.websocket and not target_client.websocket.closed:
                                    await target_client.websocket.send_json(data)
                                    logger.debug(f"🔄 Relayed {msg_type} from {from_id} to {target_id}")
                            else:
                                logger.warning(f"⚠️  Target client {target_id} not found for {msg_type}")
                        
                        # Broadcast messages (e.g., playback control)
                        elif msg_type in ['play', 'pause', 'track_change']:
                            room_id = data.get('room_id')
                            if room_id:
                                await self._broadcast_to_room(room_id, data, exclude_client=client_id)
                        
                    except json.JSONDecodeError:
                        logger.error("❌ Invalid JSON in WebSocket message")
                    except Exception as e:
                        logger.error(f"❌ WebSocket message error: {e}")
                
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f"❌ WebSocket error: {ws.exception()}")
        
        except Exception as e:
            logger.error(f"❌ WebSocket connection error: {e}")
        
        finally:
            # Cleanup on disconnect
            if client_id and client_id in self.clients:
                client = self.clients[client_id]
                room_id = client.room_id
                
                # Remove from room
                if room_id in self.rooms:
                    room = self.rooms[room_id]
                    if client_id in room.connected_clients:
                        del room.connected_clients[client_id]
                        
                        if client.role == 'dj':
                            room.dj_client_id = None
                        
                        # Notify others
                        await self._broadcast_to_room(room_id, {
                            'type': 'client_left',
                            'client_id': client_id,
                            'role': client.role
                        })
                
                del self.clients[client_id]
                logger.info(f"🔌 WebSocket closed: {client_id}")
            
            return ws
    
    async def _handle_health(self, request: web.Request) -> web.Response:
        return web.json_response({
            'status': 'ok',
            'mode': 'p2p_signaling',
            'users': len(self.users),
            'rooms': len(self.rooms),
            'connected_clients': len(self.clients),
            'rooms_detail': [r.to_dict() for r in self.rooms.values()]
        })
    
    def run(self) -> None:
        logger.info(f"🚀 P2P Silent Disco (Signaling Server) on http://{self.host}:{self.port}")
        logger.info("📡 Pure WebSocket signaling - No audio processing")
        web.run_app(self.app, host=self.host, port=self.port)


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Silent Disco P2P Signaling Server')
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=3000)
    parser.add_argument('--debug', action='store_true')
    
    args = parser.parse_args()
    
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
    
    server = SilentDiscoP2PServer(host=args.host, port=args.port)
    server.run()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        logger.info("\n👋 Shutting down...")
        sys.exit(0)
    except Exception as e:
        logger.error(f"❌ Fatal: {e}")
        sys.exit(1)
