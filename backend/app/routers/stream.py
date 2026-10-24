from fastapi import APIRouter, WebSocket

from app.hub import hub

router = APIRouter(tags=["stream"])


@router.websocket("/ws")
async def stream(ws: WebSocket) -> None:
    """One per browser tab: it subscribes to topics and gets their changes pushed (hub.py)."""
    await hub.serve(ws)
