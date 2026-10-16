import subprocess

import pytest

from app import settings, updater


def run(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def commit(cwd, name, text, message):
    (cwd / name).write_text(text)
    run(cwd, "add", name)
    run(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", message)


@pytest.fixture
def repos(tmp_path, monkeypatch):
    """An 'origin', the Pi's clone of it, and a dev clone that pushes new commits."""
    origin, pi, dev = tmp_path / "origin.git", tmp_path / "pi", tmp_path / "dev"
    run(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    run(tmp_path, "clone", "-q", str(origin), str(dev))
    commit(dev, "README.md", "one\n", "first")
    run(dev, "push", "-q", "origin", "HEAD:main")
    run(tmp_path, "clone", "-q", str(origin), str(pi))
    monkeypatch.setattr(settings, "REPO_DIR", pi)
    return pi, dev


def test_up_to_date(repos):
    state = updater.check(fetch=True)
    assert state["error"] is None
    assert state["behind"] == 0 and state["commits"] == [] and state["dirty"] == []
    assert state["current"]["subject"] == "first"
    assert state["upstream"] == "origin/main"


def test_lists_new_commits_with_their_files(repos):
    pi, dev = repos
    commit(dev, "a.txt", "a\n", "Add a\n\n- details on a")
    commit(dev, "README.md", "two\n", "Change readme")
    run(dev, "push", "-q", "origin", "HEAD:main")

    assert updater.check(fetch=False)["behind"] == 0        # not fetched yet
    state = updater.check(fetch=True)
    assert state["behind"] == 2
    assert [c["subject"] for c in state["commits"]] == ["Change readme", "Add a"]
    assert state["commits"][1]["body"] == "- details on a"
    assert state["commits"][1]["files"] == [{"status": "A", "path": "a.txt"}]
    assert state["commits"][0]["files"] == [{"status": "M", "path": "README.md"}]
    assert "2 files changed" in state["diffstat"]


def test_local_changes_block_the_update(repos):
    pi, dev = repos
    commit(dev, "a.txt", "a\n", "Add a")
    run(dev, "push", "-q", "origin", "HEAD:main")
    (pi / "README.md").write_text("edited on the pi\n")
    updater.check(fetch=True)
    assert updater.check(fetch=False)["dirty"] == ["README.md"]
    with pytest.raises(updater.UpdateError, match="local changes"):
        updater.start()


def test_nothing_to_do_or_busy(repos):
    with pytest.raises(updater.UpdateError, match="busy|receiving|up to date"):
        updater.start()
    pi, dev = repos
    commit(dev, "a.txt", "a\n", "Add a")
    run(dev, "push", "-q", "origin", "HEAD:main")
    updater.check(fetch=True)
    with pytest.raises(updater.UpdateError, match="pass is being received"):
        updater.start("a pass is being received; update after it ends")
