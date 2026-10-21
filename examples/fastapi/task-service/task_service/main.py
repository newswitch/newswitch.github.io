from .api import create_app
from .config import Settings


def create_from_env():
    return create_app(Settings())
