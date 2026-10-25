import asyncio
import logging

from app import jobs


async def until_done(pass_id, target):
    for _ in range(200):
        if not jobs.is_running(pass_id, target):
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the job did not end")


def test_one_job_per_pass_and_target_at_a_time():
    async def main():
        gate, done = asyncio.Event(), []

        async def work():
            await gate.wait()
            done.append(1)

        assert jobs.start("p", "discord", work)
        assert not jobs.start("p", "discord", work)          # a second click while it runs
        assert jobs.start("p", "hub:hub", work)               # another target goes alongside
        running = (await jobs.view())["running"]
        assert sorted(j["target"] for j in running) == ["discord", "hub:hub"] and all(j["by_hand"] for j in running)
        gate.set()
        await until_done("p", "discord")
        await until_done("p", "hub:hub")
        assert done == [1, 1] and (await jobs.view())["running"] == []

    asyncio.run(main())


def test_errors_the_work_notes_itself_are_not_logged(caplog):
    async def main():
        async def noted():
            raise ValueError("noted in pass.json")

        async def broken():
            raise RuntimeError("a bug")

        jobs.start("p", "discord", noted, (ValueError,))
        jobs.start("q", "discord", broken, (ValueError,))
        await until_done("p", "discord")
        await until_done("q", "discord")

    with caplog.at_level(logging.ERROR):
        asyncio.run(main())
    assert "for pass p" not in caplog.text and "for pass q failed" in caplog.text


def test_automatic_posting_shows_as_a_job():
    async def main():
        async with jobs.running_as("p", "discord"):
            assert jobs.is_running("p", "discord")
            assert (await jobs.view())["running"][0]["by_hand"] is False
        assert not jobs.is_running("p", "discord")

    asyncio.run(main())
