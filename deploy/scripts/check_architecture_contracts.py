#!/usr/bin/env python3
"""Run the MECHA architecture/API-management contract suite.

This is the single pre-refactor gate for work that touches routing, API
provider configuration, provider runtime resolution, health monitoring, or
frontend request/auth plumbing.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ContractScript:
    name: str
    path: str


CONTRACT_SCRIPTS: tuple[ContractScript, ...] = (
    ContractScript("api-config-runtime-loader", "scripts/check_api_config_runtime_loader.py"),
    ContractScript("admin-api-config-crud", "scripts/check_admin_api_config_crud.py"),
    ContractScript("admin-api-config-import", "scripts/check_admin_api_config_import.py"),
    ContractScript("admin-api-config-health", "scripts/check_admin_api_config_health.py"),
    ContractScript("provider-contract", "scripts/check_provider_contract.py"),
    ContractScript("provider-health-monitor", "scripts/check_provider_health_monitor.py"),
    ContractScript("ai-proxy-failover", "scripts/check_ai_proxy_failover.py"),
    ContractScript("audio-provider-runtime", "scripts/check_audio_provider_runtime.py"),
    ContractScript("service-dao-boundary", "scripts/check_service_dao_boundary.py"),
    ContractScript("route-mvc-frontend-contract", "scripts/check_route_contract.py"),
)


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--list",
        action="store_true",
        help="List contract scripts without running them.",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="NAME",
        help="Run only a named contract. Can be passed more than once.",
    )
    return parser.parse_args()


def selected_contracts(names: list[str]) -> tuple[ContractScript, ...]:
    if not names:
        return CONTRACT_SCRIPTS
    wanted = set(names)
    known = {item.name for item in CONTRACT_SCRIPTS}
    unknown = sorted(wanted - known)
    if unknown:
        print(f"Unknown contract name(s): {', '.join(unknown)}", file=sys.stderr)
        print("Known contracts:", file=sys.stderr)
        for item in CONTRACT_SCRIPTS:
            print(f"  {item.name}", file=sys.stderr)
        raise SystemExit(2)
    return tuple(item for item in CONTRACT_SCRIPTS if item.name in wanted)


def run_contract(root: Path, item: ContractScript) -> int:
    script = root / item.path
    if not script.exists():
        print(f"FAIL: missing contract script: {item.path}", file=sys.stderr)
        return 1

    env = os.environ.copy()
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")

    start = time.perf_counter()
    print(f"\n=== {item.name} ===", flush=True)
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=root,
        env=env,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="")
    elapsed = time.perf_counter() - start
    if result.returncode == 0:
        print(f"--- {item.name}: OK ({elapsed:.1f}s)")
    else:
        print(f"--- {item.name}: FAIL rc={result.returncode} ({elapsed:.1f}s)", file=sys.stderr)
    return int(result.returncode or 0)


def main() -> int:
    args = parse_args()
    root = deploy_root()
    contracts = selected_contracts(args.only)

    if args.list:
        for item in contracts:
            print(f"{item.name}\t{item.path}")
        return 0

    failures: list[tuple[str, int]] = []
    start = time.perf_counter()
    for item in contracts:
        code = run_contract(root, item)
        if code:
            failures.append((item.name, code))
            break

    elapsed = time.perf_counter() - start
    if failures:
        name, code = failures[0]
        print(f"\nArchitecture contract suite FAILED at {name} (rc={code}) after {elapsed:.1f}s", file=sys.stderr)
        return code

    print("\nArchitecture contract suite OK")
    print(f"  contracts={len(contracts)}")
    print(f"  elapsed_seconds={elapsed:.1f}")
    return 0


if __name__ == "__main__":
    configure_stdio()
    raise SystemExit(main())
