from pathlib import Path
import sys


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from run_agentic_test_suite import (  # noqa: E402
    FAIL,
    NOT_ATTEMPTED,
    PARTIAL,
    PASS,
    TestCase as AgentTestCase,
    build_plan,
    run_case,
    write_reports,
)


def test_build_plan_adds_live_smoke_only_when_requested(tmp_path):
    environment = {
        "npm": "npm",
        "git": "git",
        "node": "node",
        "browser": "browser",
        "frontend_dependencies": True,
        "backend_tests": True,
    }

    local_plan = build_plan(tmp_path, environment, None)
    live_plan = build_plan(tmp_path, environment, "https://tv.ostory.ai")

    assert "public-smoke" not in {case.case_id for case in local_plan}
    assert "public-smoke" in {case.case_id for case in live_plan}
    assert "browser-public-smoke" in {case.case_id for case in live_plan}


def test_run_case_classifies_pass_fail_and_not_attempted(tmp_path):
    passing = AgentTestCase(
        "pass",
        "pass",
        (sys.executable, "-c", "print('ok')"),
        tmp_path,
        10,
        "unit",
    )
    failing = AgentTestCase(
        "fail",
        "fail",
        (sys.executable, "-c", "raise SystemExit(3)"),
        tmp_path,
        10,
        "unit",
    )
    unavailable = AgentTestCase(
        "skip",
        "skip",
        ("missing",),
        tmp_path,
        10,
        "unit",
        "dependency unavailable",
    )
    partial = AgentTestCase(
        "partial",
        "partial",
        (sys.executable, "-c", "print('database unavailable')"),
        tmp_path,
        10,
        "unit",
        partial_output_markers=("database unavailable",),
    )

    assert run_case(passing).status == PASS
    assert run_case(failing).status == FAIL
    assert run_case(unavailable).status == NOT_ATTEMPTED
    assert run_case(partial).status == PARTIAL


def test_write_reports_preserves_raw_evidence(tmp_path):
    result = run_case(AgentTestCase(
        "evidence",
        "Evidence case",
        (sys.executable, "-c", "print('observed-output')"),
        tmp_path,
        10,
        "unit",
    ))

    markdown_path, jsonl_path = write_reports(tmp_path, {"python": sys.executable}, [result])

    assert "observed-output" in markdown_path.read_text(encoding="utf-8")
    assert '"phase": "execute"' in jsonl_path.read_text(encoding="utf-8")


def test_smoke_test_uses_console_safe_status_markers():
    smoke_source = (SCRIPTS_DIR / "smoke_test.py").read_text(encoding="utf-8")

    assert 'marker = "[PASS]" if cond else "[FAIL]"' in smoke_source
    assert "✅" not in smoke_source
    assert "❌" not in smoke_source


def test_smoke_test_retries_public_register_security_probe():
    smoke_source = (SCRIPTS_DIR / "smoke_test.py").read_text(encoding="utf-8")

    register_probe = smoke_source.split('check("公开注册已关闭(403)"', 1)[0].rsplit(
        "st, _ = ",
        1,
    )[1]
    assert register_probe.startswith("req_with_network_retry(")
    assert '"/api/auth/register"' in register_probe
    assert 'check("公开注册已关闭(403)", st == 403' in smoke_source


def test_browser_smoke_covers_supported_public_viewports():
    browser_source = (SCRIPTS_DIR / "browser_public_smoke.mjs").read_text(encoding="utf-8")

    assert "desktop-1366" in browser_source
    assert "desktop-1920" in browser_source
    assert "mobile-390" in browser_source
    assert "redirectedToLogin" in browser_source
    assert "loginUiPresent" in browser_source
    assert "Runtime.exceptionThrown" in browser_source
    assert "overflowPixels <= 2" in browser_source
