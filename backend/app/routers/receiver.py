import asyncio
import time

from fastapi import APIRouter, HTTPException

from app import receiver_test
from app.config import Sdr
from app.tasks import tracker

router = APIRouter(prefix="/receiver", tags=["receiver"])


@router.post("/test")
async def test_receiver(sdr: Sdr) -> dict:
    """Test the receiver with these settings (the ones on the page, saved or not)."""
    if tracker.receiving():
        raise HTTPException(409, "a pass is being received; test the receiver after it ends")
    # the test holds the receiver for a few seconds; SatDump needs it free when the next pass starts
    next_aos = ((tracker.data or {}).get("object_tracker") or {}).get("next_aos_time", 0)
    if 0 < next_aos - time.time() < 60:
        raise HTTPException(409, "a pass starts in less than a minute; test the receiver after it")
    return await asyncio.to_thread(receiver_test.run, sdr)
