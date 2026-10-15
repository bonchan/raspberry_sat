from dataclasses import asdict

from fastapi import APIRouter

from app.supervisor import supervisor

router = APIRouter(tags=["logs"])


@router.get("/logs")
def get_logs(after: int = 0) -> dict:
    """Lines newer than `after` (a seq number). `last` going backwards means the app restarted."""
    return {
        "lines": [asdict(line) for line in supervisor.lines if line.seq > after],
        "last": supervisor.last_seq,
    }
