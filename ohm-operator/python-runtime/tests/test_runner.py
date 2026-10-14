import os


def test_runs_allowed_tool_and_audits(runner):
    result = runner.request("py_version")
    assert result.status == "ok" and result.exit_code == 0
    assert "Python" in (result.stdout + result.stderr)
    entry = runner.audit.recent()[0]
    assert (entry["action"], entry["target"], entry["decision"], entry["result"]) == ("tool.run", "py_version", "allow", "ok exit=0")


def test_args_passed_as_list_not_shell(runner):
    result = runner.request("py_echo", ["hello", "; echo pwned", "$(whoami)"])
    assert result.status == "ok"
    assert result.stdout.strip() == "hello ; echo pwned $(whoami)"


def test_unknown_tool_denied_and_audited(runner):
    result = runner.request("format_c")
    assert result.status == "denied"
    entry = runner.audit.recent()[0]
    assert entry["decision"] == "deny" and entry["result"].startswith("blocked")


def test_destructive_tool_queues_approval_without_running(runner):
    result = runner.request("nuke")
    assert result.status == "pending" and result.approval_id
    assert result.stdout == ""
    assert runner.approvals.pending()[0]["id"] == result.approval_id
    assert runner.audit.recent()[0]["result"] == f"pending:{result.approval_id}"


def test_approved_destructive_tool_runs(runner):
    pending = runner.request("nuke")
    row = runner.approvals.resolve(pending.approval_id, "approved")
    result = runner.request(row["target"], row["detail"]["args"], approved_id=pending.approval_id)
    assert result.status == "ok" and result.stdout.strip() == "nuked"
    assert runner.audit.recent()[0]["detail"]["approval_id"] == pending.approval_id


def test_failed_exit_code(runner):
    result = runner.request("py_fail")
    assert result.status == "failed" and result.exit_code == 3
    assert runner.audit.recent()[0]["result"] == "failed exit=3"


def test_timeout(runner):
    result = runner.request("py_sleep")
    assert result.status == "error" and "timed out" in result.reason


def test_missing_executable(runner):
    result = runner.request("missing_bin")
    assert result.status == "error" and "not found" in result.reason


def test_cwd_placeholder(runner, tmp_path):
    result = runner.request("py_cwd")
    assert os.path.samefile(result.stdout.strip(), tmp_path / "projects" / "demo")


def test_missing_cwd(runner, cfg):
    runner.tools["py_cwd"]["cwd"] = "{workspace}/gone"
    result = runner.request("py_cwd")
    assert result.status == "error" and "working directory" in result.reason


def test_list_tools(runner):
    tools = {t["name"]: t for t in runner.list_tools()}
    assert tools["nuke"]["decision"] == "approve"
    assert tools["py_version"]["decision"] == "allow"
