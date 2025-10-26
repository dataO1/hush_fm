#!/bin/bash

# Set environment variables
export LIVEKIT_WS_URL=ws://192.168.178.79:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=m2yYtSY5XDaekJ26wf8ZKMnHKPQwD2L3

# Kill old processes
pkill -f livekit-server
pkill -f "python main.py"

# Wait for ports to free
sleep 2

# Start LiveKit
echo "Starting LiveKit (HTTP)..."
livekit-server --config livekit.yaml &

# Wait for LiveKit to start
sleep 3

# Start Python server
echo "Starting Python HTTP server..."
echo "Access: http://192.168.178.79:3000"
python main.py
