# Bugs
## Critical
- [ ] the dj getusermedia is asking for video permissions both on firefox and
  chrome, we only want audio!
- [ ] when a page in the frontend is requested make sure to properly initialize
  the store with an empty state. currently when connected as a listener with a
  succeeded active webrtc connection to the dj, then pressing back to the lobby,
  the webrtc connection is still active and i still hear audio (tested only on
  firefox on linux and ios, but on mobile chrome it worked). check if this
  should be done on page load (so when pressing back if page load should trigger
  and reset to page specific state, ie in lobby only connect lobby websocket,
  and reset room state with all listener and dj states) or unload.
- [ ] waveform oscilloscope only works on chrome based browsers but not for
  firefox based browsers! research why.
## Whatever
- [ ] remote connection works for udp! but somehow my chromium browser on
  wayland linux fails to create matching local ice candidate for udp!

# Architecture/Functionality
## Critical
- [ ] How to properly handle dj disconnection while streaming. we need to be
  able to keep the server room state and reconnect from the client using the
  same sessionid and just reestablish a new producer, that is still connected to
  the existing listeners/consumers/listen transports
