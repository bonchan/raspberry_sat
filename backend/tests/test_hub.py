import asyncio
import json

from fastapi import WebSocketDisconnect

from app import tasks
from app.hub import Client, Hub, encode
from app.tasks import Tracker, TrackerPush


class FakeSocket:
    """What Hub.serve uses of a WebSocket: messages from the tab come from `incoming`, None closes it."""

    def __init__(self) -> None:
        self.incoming: asyncio.Queue = asyncio.Queue()
        self.sent: list[dict] = []

    async def accept(self) -> None:
        pass

    async def receive_json(self):
        message = await self.incoming.get()
        if message is None:
            raise WebSocketDisconnect()
        return message

    async def send_text(self, text: str) -> None:
        self.sent.append(json.loads(text))


def test_subscribe_snapshot_publish_unsubscribe():
    async def run():
        hub = Hub()
        hub.topic("a", lambda: {"n": 1})
        hub.topic("b")                                      # no snapshot: waits for the next publish
        ws = FakeSocket()
        serving = asyncio.create_task(hub.serve(ws))
        await ws.incoming.put({"subscribe": ["a", "b", "unknown"]})
        await asyncio.sleep(0.01)
        watching = hub.watching("a"), hub.watching("b"), hub.watching("unknown")
        hub.publish("b", 2)
        hub.publish("c", 3)                                 # nobody: not even encoded
        await ws.incoming.put({"unsubscribe": ["b"], "subscribe": ["a"]})      # "a" again: its snapshot again
        await asyncio.sleep(0.01)
        hub.publish("b", 4)
        await asyncio.sleep(0.01)
        await ws.incoming.put(None)
        await serving
        return ws.sent, watching, hub.clients

    sent, watching, clients = asyncio.run(run())
    assert watching == (True, True, False)
    assert sent == [{"topic": "a", "data": {"n": 1}}, {"topic": "b", "data": 2}, {"topic": "a", "data": {"n": 1}}]
    assert not clients                                      # gone when the tab closed


def test_a_slow_tab_loses_the_oldest_messages():
    client = Client(None)
    for i in range(150):
        client.send(str(i))
    assert client.queue.qsize() == 100 and client.queue.get_nowait() == "50"


def test_nan_goes_out_as_null():
    assert json.loads(encode("t", {"snr": float("nan"), "x": [float("inf"), 1.5]})) == \
        {"topic": "t", "data": {"snr": None, "x": [None, 1.5]}}


def test_tracker_push_sends_a_sample_once(monkeypatch):
    hub = Hub()
    tab = Client(None)
    tab.topics = {"live", "satdump"}
    hub.clients.add(tab)
    monkeypatch.setattr(tasks, "hub", hub)
    tracker = Tracker()
    tracker.pass_started, tracker.history = 1000.0, [{"t": 1000.0, "snr": 5.0}]
    monkeypatch.setattr(tasks, "tracker", tracker)
    monkeypatch.setattr(tasks, "live_files", lambda: {"folder": "x", "cadu_bytes": 2048})
    push = TrackerPush()
    push()
    push()                                                  # read again: same sample, same process
    sent = [json.loads(tab.queue.get_nowait()) for _ in range(tab.queue.qsize())]
    assert [m["topic"] for m in sent] == ["satdump", "live", "live"]
    first, second = sent[1]["data"], sent[2]["data"]
    assert first["sample"] == {"t": 1000.0, "snr": 5.0} and first["cadu_bytes"] == 2048
    assert "sample" not in second and second["folder"] == "x"


def test_nudge_is_taken_once():
    hub = Hub()
    hub.nudge("passes")
    assert hub.nudged("passes") and not hub.nudged("passes")


def test_keep_publishes_only_changes(monkeypatch):
    from app import streams
    hub = Hub()
    tab = Client(None)
    tab.topics = {"t"}
    hub.clients.add(tab)
    monkeypatch.setattr(streams, "hub", hub)
    values = [1, 1, 2]

    async def make():
        return values.pop(0) if values else 2

    real_sleep = asyncio.sleep

    async def quick(_):
        await real_sleep(0)

    monkeypatch.setattr(streams.asyncio, "sleep", quick)

    async def run():
        task = asyncio.create_task(streams.keep("t", 1, make))
        for _ in range(10):
            await real_sleep(0)
        task.cancel()

    asyncio.run(run())
    assert [json.loads(tab.queue.get_nowait())["data"] for _ in range(tab.queue.qsize())] == [1, 2]
