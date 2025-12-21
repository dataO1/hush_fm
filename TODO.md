# TODOS
- [ ] Create a proper readme, with sections for architectur explanation, usage
  explanation, deploument (with the weird build steps we have to make due to
  aarch on pi etc). important settings for the flake
# Performance
- [ ] Frontend eats resources, check whether its the oscilloscope and if this is
  due to signals/store updates?
# Bugs
## Critical
- [x] the dj getusermedia is asking for video permissions both on firefox and
  chrome, we only want audio!
- [x] when a page in the frontend is requested make sure to properly initialize
  the store with an empty state. currently when connected as a listener with a
  succeeded active webrtc connection to the dj, then pressing back to the lobby,
  the webrtc connection is still active and i still hear audio (tested only on
  firefox on linux and ios, but on mobile chrome it worked). check if this
  should be done on page load (so when pressing back if page load should trigger
  and reset to page specific state, ie in lobby only connect lobby websocket,
  and reset room state with all listener and dj states) or unload.
- [ ] waveform oscilloscope only works on chrome based browsers but not for
  firefox based browsers! research why.
- [ ] on mobile the stream is running perfectly in the background, also in
  locked screen etc, but make sure we show a mediaplayer status or something
  that indicates that we are playing music on the lockscreen !.
- [ ] ending the stream does not send lobby update to remove room from promoted
  list.
## Whatever
- [ ] remote connection works for udp! but somehow my chromium browser on
  wayland linux fails to create matching local ice candidate for udp!
- [x] play/pause events are either not sent out by the backend or handled in the frontend! muting does not work.

# Architecture/Functionality
## Critical
- [ ] How to properly handle dj disconnection while streaming. we need to be
  able to keep the server room state and reconnect from the client using the
  same sessionid and just reestablish a new producer, that is still connected to
  the existing listeners/consumers/listen transports

# UI Update
make list autosized, not scrollable
