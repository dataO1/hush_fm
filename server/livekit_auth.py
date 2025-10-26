"""
LiveKit JWT token generation
"""
import os
import time
from typing import Optional

try:
    import jwt
except ImportError:
    raise ImportError("pyjwt is required: pip install pyjwt")


# Environment variables for LiveKit configuration
LIVEKIT_URL = os.environ.get("LIVEKIT_WS_URL", "")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")


def mint_livekit_token(identity: str, room: str, role: str, name: Optional[str] = None) -> str:
    """
    Mint a LiveKit access token for a participant

    Args:
        identity: Unique participant identifier
        room: Room name/ID
        role: 'dj' or 'listener' - determines permissions
        name: Display name (optional)

    Returns:
        JWT token string
    """
    now = int(time.time())
    exp = now + 60 * 60  # 1 hour expiry

    grants = {
        "room": room,
        "roomJoin": True,
        "roomCreate": (role == "dj"),
        "canPublish": (role == "dj"),
        "canPublishData": True,
        "canSubscribe": True
    }

    payload = {
        "iss": LIVEKIT_API_KEY,
        "sub": identity,
        "name": name or identity,
        "nbf": now - 5,  # Not before (with 5s clock skew tolerance)
        "exp": exp,
        "video": grants
    }

    return jwt.encode(payload, LIVEKIT_API_SECRET, algorithm="HS256")


def is_livekit_configured() -> bool:
    """Check if LiveKit environment variables are set"""
    return bool(LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET)
