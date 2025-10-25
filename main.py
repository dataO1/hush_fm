#!/usr/bin/env python3
"""
Silent Disco - P2P Room System with Shared Global Library
FIXED:
- Transceiver direction set to sendonly
- AudioResampler uses 'rate' parameter
- Proper PTS timestamp handling for Opus encoder
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
from fractions import Fraction

try:
    from aiohttp import web
    from aiohttp_cors import setup as cors_setup
    import aiofiles
    from mutagen.mp3 import MP3
    from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack, RTCDataChannel
    import av
except ImportError as e:
    print(f"❌ Required packages not installed: {e}")
    print("Run: pip install -r requirements-webrtc.txt")
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
class AudioFile:
    id: str
    filename: str
    original_name: str
    path: str
    uploaded_at: str
    duration: float
    uploaded_by: str
    bitrate: int = 128

    def to_dict(self) -> dict:
        return asdict(self)


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
    socket_id: str
    user_fingerprint: str
    role: str
    room_id: str
    connected_at: str
    peer_connection: Optional[RTCPeerConnection] = None
    data_channel: Optional[RTCDataChannel] = None

    def to_dict(self) -> dict:
        return {
            'socket_id': self.socket_id,
            'user_fingerprint': self.user_fingerprint,
            'role': self.role,
            'room_id': self.room_id,
            'connected_at': self.connected_at
        }


class PausableAudioTrack(MediaStreamTrack):
    kind = "audio"

    def __init__(self, filepath: str):
        super().__init__()
        self.filepath = filepath
        self.container = None
        self.audio_stream = None
        self.resampler = None
        self._is_started = False
        self._is_paused = False
        self._frame_count = 0
        self._timestamp = 0  # ✅ NEW: Track timestamp manually
        logger.info(f"🎵 Creating audio stream: {filepath}")

    def set_paused(self, paused: bool):
        self._is_paused = paused
        logger.info(f"{'⏸️  Paused' if paused else '▶️  Resumed'} audio track")

    async def _init_stream(self):
        if self._is_started:
            return

        try:
            self.container = av.open(self.filepath)
            self.audio_stream = None
            for stream in self.container.streams:
                if stream.type == 'audio':
                    self.audio_stream = stream
                    break

            if not self.audio_stream:
                raise ValueError(f"No audio stream in {self.filepath}")

            # ✅ FIX: Use 'rate' instead of 'samples_per_second'
            self.resampler = av.AudioResampler(
                format='s16',
                layout='stereo',
                rate=48000,
            )

            self._is_started = True
            logger.info(f"✅ Audio stream ready: {self.filepath}")

        except Exception as e:
            logger.error(f"❌ Stream error: {e}")
            raise

    async def recv(self) -> "av.AudioFrame":
        await self._init_stream()

        try:
            if self._is_paused:
                # Return silence with proper timestamp
                silence = av.AudioFrame(format='s16', layout='stereo', samples=960)
                for p in silence.planes:
                    p.update(bytes(p.buffer_size))
                silence.pts = self._timestamp
                silence.sample_rate = 48000
                silence.time_base = Fraction(1, 48000)
                self._timestamp += 960
                return silence

            # ✅ FIX: Catch StopIteration for clean EOF handling
            try:
                for packet in self.container.demux(self.audio_stream):
                    for frame in packet.decode():
                        resampled_frames = self.resampler.resample(frame)
                        if resampled_frames:
                            for resampled in resampled_frames:
                                resampled.pts = self._timestamp
                                resampled.sample_rate = 48000
                                resampled.time_base = Fraction(1, 48000)
                                self._timestamp += resampled.samples

                                self._frame_count += 1
                                if self._frame_count % 1000 == 0:
                                    logger.debug(f"📊 Frames sent: {self._frame_count}")
                                return resampled
            except StopIteration:
                pass  # Normal end of file

            # ✅ END OF FILE: Log once and continue with silence
            if not hasattr(self, '_eof_logged'):
                logger.info(f"🏁 Stream ended: {self.filepath}")
                self._eof_logged = True

            # Return silence after EOF
            silence = av.AudioFrame(format='s16', layout='stereo', samples=960)
            for p in silence.planes:
                p.update(bytes(p.buffer_size))
            silence.pts = self._timestamp
            silence.sample_rate = 48000
            silence.time_base = Fraction(1, 48000)
            self._timestamp += 960
            return silence

        except Exception as e:
            # ✅ Don't log "End of file" as ERROR
            if "End of file" not in str(e):
                logger.error(f"❌ Frame error: {e}")

            # Return silence on any error
            silence = av.AudioFrame(format='s16', layout='stereo', samples=960)
            for p in silence.planes:
                p.update(bytes(p.buffer_size))
            silence.pts = self._timestamp
            silence.sample_rate = 48000
            silence.time_base = Fraction(1, 48000)
            self._timestamp += 960
            return silence


@dataclass
class Room:
    id: str
    name: str
    dj_fingerprint: str
    dj_nickname: str
    created_at: str
    max_capacity: int = 50
    current_audio: Optional[AudioFile] = None
    is_playing: bool = False
    connected_clients: Dict[str, Client] = field(default_factory=dict)
    audio_track: Optional[PausableAudioTrack] = None

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'dj_nickname': self.dj_nickname,
            'created_at': self.created_at,
            'max_capacity': self.max_capacity,
            'current_audio': self.current_audio.to_dict() if self.current_audio else None,
            'is_playing': self.is_playing,
            'connected_clients': len(self.connected_clients),
            'listener_count': len([c for c in self.connected_clients.values() if c.role == 'listener']),
            'capacity_remaining': self.max_capacity - len(self.connected_clients),
            'codec': 'Opus',
            'bitrate': 128
        }


class SilentDiscoServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 3000):
        self.host = host
        self.port = port
        self.app = web.Application()
        self.upload_dir = Path("uploads")
        self.upload_dir.mkdir(exist_ok=True)

        self.users: Dict[str, User] = {}
        self.rooms: Dict[str, Room] = {}
        self.peers: Dict[str, RTCPeerConnection] = {}
        self.clients: Dict[str, Client] = {}
        self.global_library: Dict[str, AudioFile] = {}

        self._setup_routes()
        cors_setup(self.app)
        logger.info(f"🎧 P2P Silent Disco Server initialized with shared library")

    def _setup_routes(self) -> None:
        self.app.router.add_get('/', self._handle_index)
        self.app.router.add_get('/room/{room_id}', self._handle_room_url)
        self.app.router.add_static('/static', path=Path('static'), name='static')

        self.app.router.add_post('/user/identify', self._handle_identify_user)

        self.app.router.add_get('/rooms', self._handle_get_rooms)
        self.app.router.add_post('/room/create', self._handle_create_room)
        self.app.router.add_get('/api/room/{room_id}', self._handle_get_room)
        self.app.router.add_post('/room/{room_id}/join', self._handle_join_room)
        self.app.router.add_post('/room/{room_id}/leave', self._handle_leave_room)
        self.app.router.add_delete('/room/{room_id}', self._handle_delete_room)

        self.app.router.add_post('/room/{room_id}/upload', self._handle_upload)
        self.app.router.add_get('/room/{room_id}/library', self._handle_get_library)
        self.app.router.add_post('/room/{room_id}/play', self._handle_play_audio)
        self.app.router.add_post('/room/{room_id}/pause', self._handle_pause_audio)
        self.app.router.add_post('/room/{room_id}/resume', self._handle_resume_audio)

        self.app.router.add_post('/offer', self._handle_webrtc_offer)
        self.app.router.add_post('/ice-candidate', self._handle_ice_candidate)

        self.app.router.add_get('/health', self._handle_health)

    def broadcast_to_room(self, room_id: str, message: dict):
        room = self.rooms.get(room_id)
        if not room:
            return

        message_str = json.dumps(message)
        sent_count = 0

        for client in room.connected_clients.values():
            if client.data_channel and client.data_channel.readyState == 'open':
                try:
                    client.data_channel.send(message_str)
                    sent_count += 1
                except Exception as e:
                    logger.error(f"❌ Broadcast error to {client.socket_id}: {e}")

        if sent_count > 0:
            logger.info(f"📡 Broadcast to {room.name}: {message['type']} ({sent_count} clients)")

    async def broadcast_library_to_all_rooms(self):
        tracks = [f.to_dict() for f in self.global_library.values()]
        message = {
            'type': 'library_update',
            'tracks': tracks
        }

        await asyncio.sleep(0.1)

        total_sent = 0
        for room_id in self.rooms.keys():
            self.broadcast_to_room(room_id, message)
            total_sent += 1

        logger.info(f"📚 Library update sent to {total_sent} rooms ({len(tracks)} tracks)")

    async def _handle_index(self, request: web.Request) -> web.Response:
        index_path = Path('static/index.html')
        if index_path.exists():
            async with aiofiles.open(index_path, 'r') as f:
                content = await f.read()
                return web.Response(text=content, content_type='text/html')
        return web.Response(text='Silent Disco P2P Server', status=200)

    async def _handle_room_url(self, request: web.Request) -> web.Response:
        index_path = Path('static/index.html')
        if index_path.exists():
            async with aiofiles.open(index_path, 'r') as f:
                content = await f.read()
                return web.Response(text=content, content_type='text/html')
        return web.Response(text='Room not found', status=404)

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
                socket_id=client_id,
                user_fingerprint=user_fingerprint,
                role=role,
                room_id=room_id,
                connected_at=datetime.now().isoformat()
            )

            room.connected_clients[client_id] = client
            self.clients[client_id] = client

            user = self.users.get(user_fingerprint)
            nickname = user.nickname if user else 'Anonymous'

            logger.info(f"✅ {nickname} ({role}) joined {room.name} [Client: {client_id}]")

            self.broadcast_to_room(room_id, {
                'type': 'room_update',
                'listeners': len([c for c in room.connected_clients.values() if c.role == 'listener']),
                'total_clients': len(room.connected_clients)
            })

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
                logger.info(f"🔌 Client left: {client_id} from {room.name}")

                self.broadcast_to_room(room_id, {
                    'type': 'room_update',
                    'listeners': len([c for c in room.connected_clients.values() if c.role == 'listener']),
                    'total_clients': len(room.connected_clients)
                })

            if client_id in self.clients:
                del self.clients[client_id]

            if client_id in self.peers:
                try:
                    await self.peers[client_id].close()
                    logger.info(f"🔌 Closed peer connection: {client_id}")
                except:
                    pass
                del self.peers[client_id]

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

            for client_id in list(room.connected_clients.keys()):
                if client_id in self.peers:
                    try:
                        await self.peers[client_id].close()
                    except:
                        pass
                    del self.peers[client_id]

            if user_fingerprint in self.users:
                self.users[user_fingerprint].room_id = None

            del self.rooms[room_id]
            logger.info(f"🗑️  Room deleted: {room.name}")

            return web.json_response({'success': True})

        except Exception as e:
            logger.error(f"❌ Delete room error: {e}")
            return web.json_response({'error': str(e)}, status=500)

    async def _handle_upload(self, request: web.Request) -> web.Response:
        try:
            room_id = request.match_info['room_id']
            user_fingerprint = generate_fingerprint(request)

            room = self.rooms.get(room_id)
            if not room:
                return web.json_response({'error': 'Room not found'}, status=404)

            if room.dj_fingerprint != user_fingerprint:
                return web.json_response({'error': 'Only DJ can upload'}, status=403)

            reader = await request.multipart()
            field = await reader.next()

            if field.name != 'audio':
                return web.json_response({'error': 'Invalid field'}, status=400)

            filename = field.filename
            if not filename or not filename.lower().endswith('.mp3'):
                return web.json_response({'error': 'Only MP3 supported'}, status=400)

            import uuid
            file_id = str(uuid.uuid4())[:8]
            save_filename = f"{file_id}_{filename}"
            save_path = self.upload_dir / save_filename

            size = 0
            max_size = 50 * 1024 * 1024

            async with aiofiles.open(save_path, 'wb') as f:
                async for chunk in field:
                    size += len(chunk)
                    if size > max_size:
                        await aiofiles.os.remove(save_path)
                        return web.json_response({'error': 'File too large'}, status=413)
                    await f.write(chunk)

            duration = 0.0
            try:
                container = av.open(str(save_path))
                audio_stream = next(s for s in container.streams if s.type == 'audio')
                duration = float(audio_stream.duration * audio_stream.time_base)
                container.close()
            except:
                pass

            audio_file = AudioFile(
                id=file_id,
                filename=save_filename,
                original_name=filename,
                path=str(save_path),
                uploaded_at=datetime.now().isoformat(),
                duration=duration,
                uploaded_by=user_fingerprint
            )

            self.global_library[file_id] = audio_file
            logger.info(f"✅ Uploaded to global library: {filename} (ID: {file_id})")

            asyncio.create_task(self.broadcast_library_to_all_rooms())

            return web.json_response({
                'success': True,
                'audio': audio_file.to_dict()
            })

        except Exception as e:
            logger.error(f"❌ Upload error: {e}")
            return web.json_response({'error': str(e)}, status=500)

    async def _handle_get_library(self, request: web.Request) -> web.Response:
        tracks = [f.to_dict() for f in self.global_library.values()]
        return web.json_response({'tracks': tracks, 'total': len(tracks)})

    async def _handle_play_audio(self, request: web.Request) -> web.Response:
        try:
            room_id = request.match_info['room_id']
            data = await request.json()
            track_id = data.get('track_id')
            user_fingerprint = generate_fingerprint(request)

            room = self.rooms.get(room_id)
            if not room:
                return web.json_response({'error': 'Room not found'}, status=404)

            if room.dj_fingerprint != user_fingerprint:
                return web.json_response({'error': 'Only DJ can control playback'}, status=403)

            audio_file = self.global_library.get(track_id)
            if not audio_file:
                return web.json_response({'error': 'Track not found'}, status=404)

            # Stop old track if exists
            if room.audio_track:
                try:
                    room.audio_track.stop()
                except:
                    pass

            # Set new track and state
            room.current_audio = audio_file
            room.is_playing = True

            # Create ONE shared track for the room
            room.audio_track = PausableAudioTrack(audio_file.path)
            room.audio_track.set_paused(False)

            # Replace track for ALL connected clients
            added_count = 0
            for client in room.connected_clients.values():
                if client.socket_id in self.peers:
                    try:
                        peer = self.peers[client.socket_id]
                        transceivers = peer.getTransceivers()

                        if transceivers and len(transceivers) > 0:
                            audio_transceiver = transceivers[0]
                            if audio_transceiver.sender:
                                # Use the SAME room track for all clients
                                audio_transceiver.sender.replaceTrack(room.audio_track)
                                added_count += 1
                                logger.info(f"🎵 Added track to {client.socket_id}")
                            else:
                                logger.error(f"❌ Add track error for {client.socket_id}: sender is None")
                        else:
                            logger.error(f"❌ Add track error for {client.socket_id}: no transceivers")
                    except Exception as e:
                        logger.error(f"❌ Add track error for {client.socket_id}: {e}")

            # Broadcast track change to all clients
            self.broadcast_to_room(room_id, {
                'type': 'track_change',
                'track_id': audio_file.id,
                'track_name': audio_file.original_name
            })

            logger.info(f"▶️  Playing in {room.name}: {audio_file.original_name} ({added_count} clients)")

            return web.json_response({'success': True, 'clients_updated': added_count})

        except Exception as e:
            logger.error(f"❌ Play error: {e}")
            return web.json_response({'error': str(e)}, status=500)

    async def _handle_pause_audio(self, request: web.Request) -> web.Response:
        try:
            room_id = request.match_info['room_id']
            user_fingerprint = generate_fingerprint(request)

            room = self.rooms.get(room_id)
            if not room or room.dj_fingerprint != user_fingerprint:
                return web.json_response({'error': 'Unauthorized'}, status=403)

            if room.audio_track:
                room.audio_track.set_paused(True)
                room.is_playing = False

                self.broadcast_to_room(room_id, {
                    'type': 'playback_state',
                    'is_playing': False
                })
                logger.info(f"⏸️  Paused in {room.name}")

            return web.json_response({'success': True})
        except Exception as e:
            return web.json_response({'error': str(e)}, status=500)

    async def _handle_resume_audio(self, request: web.Request) -> web.Response:
        try:
            room_id = request.match_info['room_id']
            user_fingerprint = generate_fingerprint(request)

            room = self.rooms.get(room_id)
            if not room or room.dj_fingerprint != user_fingerprint:
                return web.json_response({'error': 'Unauthorized'}, status=403)

            if room.audio_track:
                room.audio_track.set_paused(False)
                room.is_playing = True

                self.broadcast_to_room(room_id, {
                    'type': 'playback_state',
                    'is_playing': True
                })
                logger.info(f"▶️  Resumed in {room.name}")

            return web.json_response({'success': True})
        except Exception as e:
            return web.json_response({'error': str(e)}, status=500)

    async def _handle_webrtc_offer(self, request: web.Request) -> web.Response:
        try:
            data = await request.json()
            offer = RTCSessionDescription(sdp=data['sdp'], type=data['type'])

            client_id = data.get('client_id')
            room_id = data.get('room_id')

            logger.info(f"📨 Received WebRTC offer from {client_id} for room {room_id}")

            peer = RTCPeerConnection()
            self.peers[client_id] = peer

            # Create DataChannel
            data_channel = peer.createDataChannel('sync')
            logger.info(f"📡 Created DataChannel for {client_id}")

            @data_channel.on('open')
            def on_open():
                logger.info(f"✅ DataChannel OPEN: {client_id}")

                if client_id in self.clients:
                    self.clients[client_id].data_channel = data_channel
                    logger.info(f"💾 Stored DataChannel reference for {client_id}")

                room = self.rooms.get(room_id)
                if room:
                    try:
                        data_channel.send(json.dumps({
                            'type': 'room_update',
                            'listeners': len([c for c in room.connected_clients.values() if c.role == 'listener']),
                            'total_clients': len(room.connected_clients)
                        }))

                        if room.current_audio:
                            data_channel.send(json.dumps({
                                'type': 'track_change',
                                'track_id': room.current_audio.id,
                                'track_name': room.current_audio.original_name
                            }))

                        data_channel.send(json.dumps({
                            'type': 'playback_state',
                            'is_playing': room.is_playing
                        }))

                        tracks = [f.to_dict() for f in self.global_library.values()]
                        data_channel.send(json.dumps({
                            'type': 'library_update',
                            'tracks': tracks
                        }))

                        logger.info(f"📤 Sent initial state to {client_id}")
                    except Exception as e:
                        logger.error(f"❌ Send initial state error for {client_id}: {e}")

            @data_channel.on('error')
            def on_error(error):
                logger.error(f"❌ DataChannel error for {client_id}: {error}")

            # Set remote description
            await peer.setRemoteDescription(offer)
            logger.info(f"📝 Set remote description for {client_id}")

            # ✅ CRITICAL FIX: Set transceiver direction and attach track
            room = self.rooms.get(room_id)
            transceivers = peer.getTransceivers()

            if transceivers and len(transceivers) > 0:
                audio_transceiver = transceivers[0]

                # ✅ FIX 1: Set direction to sendonly BEFORE creating answer
                audio_transceiver.direction = 'sendonly'
                logger.info(f"🎵 Set transceiver direction to sendonly for {client_id}")

                # ✅ FIX 2: Attach room's shared track if available
                if room and room.audio_track:
                    if audio_transceiver.sender:
                        audio_transceiver.sender.replaceTrack(room.audio_track)
                        logger.info(f"🎵 Attached audio track to {client_id}")
                    else:
                        logger.warning(f"⚠️  No sender for {client_id}")
                else:
                    logger.info(f"ℹ️  No audio track yet for {client_id} (will be added on play)")
            else:
                logger.warning(f"⚠️  No transceivers for {client_id}")

            # Create answer AFTER setting direction and track
            answer = await peer.createAnswer()
            await peer.setLocalDescription(answer)
            logger.info(f"✅ Created answer for {client_id}")

            @peer.on('connectionstatechange')
            async def on_state():
                logger.info(f"🔗 {client_id} connection state: {peer.connectionState}")

                # Clean up on disconnect
                if peer.connectionState in ['failed', 'closed', 'disconnected']:
                    if client_id in self.peers:
                        del self.peers[client_id]
                        logger.info(f"🧹 Cleaned up peer: {client_id}")

            @peer.on('iceconnectionstatechange')
            async def on_ice_state():
                logger.info(f"🧊 {client_id} ICE state: {peer.iceConnectionState}")
                if peer.iceConnectionState == 'failed':
                    logger.error(f"❌ ICE connection failed for {client_id}")
                    try:
                        await peer.close()
                        if client_id in self.peers:
                            del self.peers[client_id]
                    except:
                        pass

            return web.json_response({
                'type': 'answer',
                'sdp': peer.localDescription.sdp
            })

        except Exception as e:
            logger.error(f"❌ WebRTC offer error: {e}")
            import traceback
            traceback.print_exc()
            return web.json_response({'error': str(e)}, status=500)

    async def _handle_ice_candidate(self, request: web.Request) -> web.Response:
        try:
            data = await request.json()
            peer_id = data.get('client_id')

            if peer_id not in self.peers:
                logger.warning(f"⚠️  ICE candidate for unknown peer: {peer_id}")
                return web.json_response({'error': 'Peer not found'}, status=404)

            candidate = data.get('candidate')
            if candidate:
                await self.peers[peer_id].addIceCandidate(candidate)
                logger.debug(f"🧊 Added ICE candidate for {peer_id}")

            return web.json_response({'success': True})
        except Exception as e:
            logger.error(f"❌ ICE candidate error: {e}")
            return web.json_response({'error': str(e)}, status=500)

    async def _handle_health(self, request: web.Request) -> web.Response:
        return web.json_response({
            'status': 'ok',
            'users': len(self.users),
            'rooms': len(self.rooms),
            'peers': len(self.peers),
            'total_clients': sum(len(r.connected_clients) for r in self.rooms.values()),
            'global_library_tracks': len(self.global_library),
            'rooms_detail': [r.to_dict() for r in self.rooms.values()]
        })

    def run(self) -> None:
        logger.info(f"🚀 P2P Silent Disco on http://{self.host}:{self.port}")
        logger.info("📱 Shared global music library for all rooms")
        web.run_app(self.app, host=self.host, port=self.port)


def main():
    import argparse

    parser = argparse.ArgumentParser(description='Silent Disco P2P Server')
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=3000)
    parser.add_argument('--debug', action='store_true')

    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    server = SilentDiscoServer(host=args.host, port=args.port)
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
