"""
Utility functions for ID and name generation
"""
import random
import string


def generate_client_id(length: int = 9) -> str:
    """Generate a random client ID"""
    alphabet = string.ascii_lowercase + string.digits
    return "client_" + "".join(random.choice(alphabet) for _ in range(length))


def generate_room_id(length: int = 8) -> str:
    """Generate a random room ID (hex)"""
    return "".join(random.choice("abcdef0123456789") for _ in range(length))


def generate_client_name() -> str:
    """Generate a random fun client name"""
    adjectives = [
        "Funky", "Groovy", "Electric", "Cosmic", "Disco", "Neon",
        "Retro", "Stellar", "Jazzy", "Vibrant", "Rhythmic", "Melodic",
        "Sonic", "Dynamic"
    ]
    nouns = [
        "Beats", "Rhythm", "Vibes", "Groove", "Tempo", "Harmony",
        "Sound", "Wave", "Flow", "Pulse", "Chords", "Bass", "Echo", "Dancer"
    ]
    return random.choice(adjectives) + random.choice(nouns) + str(random.randint(1, 99))
