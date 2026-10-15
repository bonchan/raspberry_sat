import asyncio
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import networks
from app.supervisor import supervisor

router = APIRouter(prefix="/networks", tags=["networks"])

AutoconnectPriority = Annotated[int, Field(ge=-999, le=999)]     # NetworkManager's range


class NewNetwork(BaseModel):
    ssid: str = Field(min_length=1, max_length=32)
    password: str = ""
    priority: AutoconnectPriority = 0
    hidden: bool = False
    security: Literal["", "wpa-psk", "sae"] = ""     # from the scan; "" = WPA2 if there is a password


class PriorityChange(BaseModel):
    priority: AutoconnectPriority


async def call(fn, *args):
    try:
        return await asyncio.to_thread(fn, *args)
    except networks.NetworkError as e:
        raise HTTPException(409, str(e))


@router.get("")
async def get_networks() -> dict:
    """Interfaces, what they are connected to, and the saved Wi-Fi networks. `error` if nmcli is unusable."""
    try:
        return {**await asyncio.to_thread(networks.overview), "error": None}
    except networks.NetworkError as e:
        return {"devices": [], "saved": [], "error": str(e)}


@router.get("/scan")
async def scan() -> dict:
    return {"networks": await call(networks.scan)}


@router.post("")
async def save(network: NewNetwork) -> dict:
    result = await call(networks.save_network, network.ssid, network.password, network.priority,
                        network.hidden, network.security)
    supervisor.note("info", f"Wi-Fi network {network.ssid} {result} from the web page")
    return {"result": result}


@router.patch("/{uuid}")
async def change_priority(uuid: str, body: PriorityChange) -> dict:
    await call(networks.set_priority, uuid, body.priority)
    return {"uuid": uuid, "priority": body.priority}


@router.delete("/{uuid}")
async def forget(uuid: str) -> dict:
    network = await call(networks.forget, uuid)
    supervisor.note("info", f"Wi-Fi network {network['ssid']} forgotten from the web page")
    return {"forgotten": uuid}
