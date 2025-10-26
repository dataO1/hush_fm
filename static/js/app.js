// Main entry point: routing, initialization
import { state, log } from './state.js';
import { loadIceConfig, identify, roomExists, joinRoom, fetchLkToken, closeRoom, startPresenceHeartbeat } from './api.js';
import { connectRoom, ensurePublishedPresence } from './livekit.js';
import { ensureDeviceList } from './audio.js';
import { show, updateMuteButton, highlightActiveSource, setDjRoomMeta, setListenerRoomMeta, renderRoomsList, initButtons } from './ui.js';

function parseRoute() {
  const path = location.pathname.replace(/\/+$/, '');
  const m = path.match(/^\/r\/([a-f0-9]{8})$/i);
  const params = new URLSearchParams(location.search);
  return { roomId: m ? m[1] : null, asDj: params.get('dj') === '1' };
}

function navigateToRoom(roomId, asDj = false) {
  const url = `/r/${roomId}${asDj ? '?dj=1' : ''}`;
  history.pushState({}, '', url);
}

function navigateToRoot() {
  history.pushState({}, '', '/');
}

async function ensureIdentityReady() {
  if (!state.clientId) {
    await identify();
    await loadIceConfig();
  }
}

async function enterRoom(roomId, role) {
  if (!(await roomExists(roomId))) {
    log('Room not found, redirecting to home');
    navigateToRoot();
    show(document.getElementById('landing'));
    await renderRoomsList();
    return;
  }
  state.roomId = roomId;
  state.role = role;
  const joinRes = await joinRoom(roomId, role);
  if (!joinRes.ok) {
    log('Join failed', joinRes.error || '');
    navigateToRoot();
    show(document.getElementById('landing'));
    await renderRoomsList();
    return;
  }
  state.roomName = joinRes.name || state.roomName || '';
  const { url, token } = await fetchLkToken(role, roomId);
  await connectRoom(url, token);
  if (role === 'dj') {
    setDjRoomMeta();
    show(document.getElementById('djView'));
    await ensureDeviceList();
    await ensurePublishedPresence();
    updateMuteButton();
    highlightActiveSource();
  } else {
    const rooms = await (await fetch('/rooms')).json();
    const r = rooms.rooms.find(x => x.id === roomId) || {};
    setListenerRoomMeta({ name: r.name, dj_name: r.dj_name, listener_count: r.listener_count });
    if (!r.dj_online) document.getElementById('offline').classList.remove('hidden');
    show(document.getElementById('listenerView'));
  }
}

async function closeFloor() {
  if (!state.roomId || state.role !== 'dj') return;
  try {
    if (state.lkRoom) {
      const msg = new TextEncoder().encode(JSON.stringify({ type: 'room_close' }));
      try {
        await state.lkRoom.localParticipant.publishData(msg, { reliable: true });
      } catch {}
    }
  } catch {}
  try {
    await closeRoom(state.roomId);
  } catch {}
  try {
    state.lkRoom?.disconnect();
  } catch {}
  state.lkRoom = null;
  state.localTrack = null;
  state.currentPub = null;
  state.onAir = false;
  navigateToRoot();
  show(document.getElementById('landing'));
  await renderRoomsList();
}

window.addEventListener('popstate', async () => {
  const route = parseRoute();
  if (route.roomId) {
    await ensureIdentityReady();
    await enterRoom(route.roomId, route.asDj ? 'dj' : 'listener');
  } else {
    show(document.getElementById('landing'));
    await renderRoomsList();
  }
});

window.addEventListener('load', async () => {
  await ensureIdentityReady();
  const route = parseRoute();
  if (route.roomId) {
    if (!(await roomExists(route.roomId))) {
      navigateToRoot();
      show(document.getElementById('landing'));
      await renderRoomsList();
      return;
    }
    navigateToRoom(route.roomId, route.asDj);
    await enterRoom(route.roomId, route.asDj ? 'dj' : 'listener');
  } else {
    show(document.getElementById('landing'));
    await renderRoomsList();
    setInterval(renderRoomsList, 4000);
  }
  updateMuteButton();
  initButtons(enterRoom, closeFloor);
  startPresenceHeartbeat();

  // Hook up room list join buttons
  document.getElementById('roomsList').addEventListener('click', async e => {
    const btn = e.target.closest('.join');
    if (!btn) return;
    const rid = btn.getAttribute('data-id');
    const role = btn.getAttribute('data-role');
    navigateToRoom(rid, role === 'dj');
    await enterRoom(rid, role);
  });
});
