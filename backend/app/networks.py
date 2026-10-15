"""Wi-Fi networks, through NetworkManager (nmcli), which Raspberry Pi OS Bookworm uses.

Saved networks connect by themselves when the Pi is not connected and one of them is in range;
the highest autoconnect priority wins. Reading needs no privileges; changes go through
`sudo -n nmcli` (passwordless sudo, as for updates). Saved passwords are never read back.
"""

import subprocess

WIFI_TYPES = ("802-11-wireless", "wifi")


class NetworkError(Exception):
    pass


def nmcli(*args: str, sudo: bool = False, timeout: float = 30) -> str:
    cmd = (["sudo", "-n"] if sudo else []) + ["nmcli", *args]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as e:
        raise NetworkError("NetworkManager (nmcli) is not available") from e
    except (OSError, subprocess.TimeoutExpired) as e:
        raise NetworkError(f"nmcli: {e}") from e
    if r.returncode != 0:
        raise NetworkError(r.stderr.strip() or r.stdout.strip() or "nmcli failed")
    return r.stdout


def split_terse(line: str) -> list[str]:
    """The fields of one `nmcli -t` line: ':' separates them, '\\:' and '\\\\' are escaped."""
    fields, current, i = [], [], 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            current.append(line[i + 1])
            i += 2
            continue
        if c == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(c)
        i += 1
    fields.append("".join(current))
    return fields


def rows(output: str) -> list[list[str]]:
    return [split_terse(line) for line in output.splitlines() if line]


# ---------- reading ----------

def devices() -> list[dict]:
    """Wi-Fi and Ethernet interfaces, with the connection each is using."""
    out = []
    for fields in rows(nmcli("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status")):
        device, kind, state, connection = (fields + ["", "", "", ""])[:4]
        if kind in ("wifi", "ethernet"):
            out.append({"device": device, "type": kind, "connected": state.startswith("connected"),
                        "state": state, "connection": connection})
    return out


def wifi_device() -> str | None:
    return next((d["device"] for d in devices() if d["type"] == "wifi"), None)


def saved_networks() -> list[dict]:
    out = []
    for fields in rows(nmcli("-t", "-f", "NAME,UUID,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY,ACTIVE", "connection", "show")):
        name, uuid, kind, autoconnect, priority, active = (fields + [""] * 6)[:6]
        if kind not in WIFI_TYPES:
            continue
        ssid = split_terse(nmcli("-t", "-g", "802-11-wireless.ssid", "connection", "show", uuid).strip())[0]
        out.append({"uuid": uuid, "name": name, "ssid": ssid or name, "autoconnect": autoconnect == "yes",
                    "priority": int(priority or 0), "active": active == "yes"})
    out.sort(key=lambda n: (-n["priority"], n["ssid"].lower()))
    return out


def overview() -> dict:
    return {"devices": devices(), "saved": saved_networks()}


def scan() -> list[dict]:
    """Networks in range, strongest first, one entry per name."""
    fields = ["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list"]
    try:
        out = nmcli(*fields, "--rescan", "yes", sudo=True, timeout=45)      # a fresh scan needs privileges
    except NetworkError:
        out = nmcli(*fields, "--rescan", "no")                              # the last scan NetworkManager made
    best: dict[str, dict] = {}
    for row in rows(out):
        in_use, ssid, signal, security = (row + ["", "", "", ""])[:4]
        if not ssid:
            continue                                                        # hidden networks have no name
        entry = {"ssid": ssid, "signal": int(signal or 0), "security": security.strip(), "in_use": in_use == "*"}
        known = best.get(ssid)
        if known is None or entry["signal"] > known["signal"]:
            entry["in_use"] = entry["in_use"] or bool(known and known["in_use"])
            best[ssid] = entry
        elif entry["in_use"]:
            known["in_use"] = True
    return sorted(best.values(), key=lambda n: -n["signal"])


# ---------- changing ----------

def find(uuid: str) -> dict:
    network = next((n for n in saved_networks() if n["uuid"] == uuid), None)
    if network is None:
        raise NetworkError("no such saved network")
    return network


def save_network(ssid: str, password: str, priority: int, hidden: bool, security: str) -> str:
    """Add a network, or update the saved one with that name. An empty password means an open network
    when adding, and 'keep the saved password' when updating. Returns 'added' or 'updated'."""
    if not 1 <= len(ssid.encode("utf-8")) <= 32:
        raise NetworkError("a network name has 1 to 32 bytes")
    if password and not 8 <= len(password) <= 63:
        raise NetworkError("Wi-Fi passwords have 8 to 63 characters")

    settings = ["connection.autoconnect", "yes", "connection.autoconnect-priority", str(priority),
                "802-11-wireless.hidden", "yes" if hidden else "no"]
    if password:
        key_mgmt = "sae" if security == "sae" else "wpa-psk"        # sae: WPA3-only networks
        settings += ["wifi-sec.key-mgmt", key_mgmt, "wifi-sec.psk", password]

    existing = next((n for n in saved_networks() if n["ssid"] == ssid), None)
    if existing:
        nmcli("connection", "modify", existing["uuid"], *settings, sudo=True)
        return "updated"
    device = wifi_device()
    if device is None:
        raise NetworkError("this Pi has no Wi-Fi interface")
    nmcli("connection", "add", "type", "wifi", "ifname", device, "con-name", ssid, "ssid", ssid,
          *settings, sudo=True)
    return "added"


def set_priority(uuid: str, priority: int) -> None:
    find(uuid)
    nmcli("connection", "modify", uuid, "connection.autoconnect-priority", str(priority), sudo=True)


def forget(uuid: str) -> dict:
    network = find(uuid)
    if network["active"]:
        raise NetworkError("the Pi is connected through this network right now; forgetting it would cut the connection")
    nmcli("connection", "delete", uuid, sudo=True)
    return network
