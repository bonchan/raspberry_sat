from fastapi import APIRouter, HTTPException

from app import discord, settings
from app.config import Discord, load_config

router = APIRouter(prefix="/discord", tags=["discord"])


@router.post("/test")
async def test(cfg: Discord) -> dict:
    """Post a short message with the bot settings as they are on the page, saved or not."""
    try:
        return await discord.send_test(cfg, load_config(settings.CONFIG_FILE).display.language)
    except discord.DiscordError as e:
        raise HTTPException(502, str(e)) from e
