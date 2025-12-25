messages are websocket messages, the rest is handled via mediasoup events
directly
# DJ/Producer room creation flow
1. frontend announce room creation in lobby websocket, which creates the room in a unfinished state, with its worker and router and returns a dj websocket.
2. frontend connects to the room and dj websocket, send room init message to the dj websocket (via message) , receive rtpCapabilities from backend/room (via message)
3. frontend Create new device and call load() with received rtpCapabilities
4. frontend Call getUserMedia(options) and get audio track
5. frontend Request Webrtctransport from backend (via message)
6. Backend uses router to create sender transport
7. backend returns transport params(containing transport id, iceparams,
   icecandidates, dtlsparams)
8. frontend uses previously generated device to create send transport
9. frontend use send transport and calls produce({}) with client encodings, codec options (so opus bitrate etc, which the client decides, based on the mediainput) which fires of two events(connect &
   produce)
10. frontend connect handler returns dtlsparams
13. backend calls connect({dtlsparams}) on the previously created sendtransport
    for the dj
14. frontend produce handler returns parameters(kind, rtpparams), callback and errback
15. frontend send parameters to backend (via message)
12. frontend send dtls to backend (via message)
16. backend calls produce() on send transport and passin parameters ({kind,
    rtpParameters}), which creates server side producer
17. backend then saves the producerid in the room, marks the room as public and
    sends the producerid to the dj and publishes the room
11. frontend waits for webrtc connection to be established
18. frontend: on receiving the producerid, we can call the previously received
    callback method, which lets the local producer know that the server is ready
    and provides it the producer id
19. also handle the errback method in case we encounter an error: in this case,
    cancel the room creation, cleanup room (via message)


# Listener room connection flow

1. Frontend: Request joining a room (via lobby message) from lobby, which creates a
   unique websocket for the listener for this room and returns this websocket
   url (via lobby message) -> ui goes into listener view and connects to this
   websocket.
2. Frontend: request rtpcapabilities from backend (via listener websocket)
3. Backend: returns rtpcapbailities to frontend (via listener websocket)
4. Frontend: initialise transport receiver (via listener message)
5. Backend: uses router of the room to create a webrtc transport receiver and
   send transport params back to frontend (via message over listener websocket,
   not lobby)
6. frontend: use device to create receive transport locally from params
7. frontend: extract and send device rtpcapabilities (via message) to backend.
8. backend: checks if router can consume (canConsume() method), if so call consume({rtp,producer id
   stored in room}) of the listeners transport, which creates a consumer
6a. backend sends consumerparams (consumerid, kind, rtp params) to frontend (via message)
7a. frontend: use receive transport .consume({}) method, which creates clietn side consumer andfires of connect event
8a. frontend: connect handler returns dtls params, which we send to the backend
   (via message)
9a. backend: call connect({dtlsparams}) on receiver transport
10a. media should start streaming now

6b. backend (in case the router doesnt match) returns error
7b. frontend error received, cancel joining room show error message, go back to
lobby.


## NOTES
Important to understand is that each the server and the client have a transport
for each connection (ie. for the dj the client and server both have a send
transport). How these are connected is described [in the documentation for communication between client and server](https://mediasoup.org/documentation/v3/communication-between-client-and-server/).
