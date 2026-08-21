#!/usr/bin/env python3
"""Fail when tracked source exposes private provenance or usable credentials.

The release check deliberately reports only a rule name and source location. It
does not echo matching text, because a scanner should not copy a discovered
credential into CI logs. Add a narrowly documented exception only when a term is
part of a public protocol rather than repository history.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SELF_PATH = "deploy/scripts/check_open_source_hygiene.py"


@dataclass(frozen=True)
class HygieneIssue:
    path: str
    line: int
    rule: str


FORBIDDEN_CONTENT = {
    "private repository reference": re.compile(
        r"(?:Drama/NewUI|wuqi80/Drama|git\.5kcrm\.cn|refactor/v2)", re.IGNORECASE
    ),
    "private product or domain": re.compile(
        r"(?:spti\.ai|(?:[\w-]+\.)?5kcrm\.cn|rongyansuanli\.com|mecha\.one)", re.IGNORECASE
    ),
    "migrated runtime identifier": re.compile(
        r"(?:@drama/|dramaRuntime|createDramaRuntime|DRAMA_[A-Z0-9_]*|drama\.service|\bNewUI\b)"
    ),
    "private machine path": re.compile(r"(?:[A-Z]:\\Codex\\Drama|/[^\s]*/Drama/deploy)", re.IGNORECASE),
    "personal fixture identifier": re.compile(r"\bwuqi80\b", re.IGNORECASE),
    "legacy product identifier": re.compile(r"(?:\bMY2\b|my2[_:-]|h-my2)", re.IGNORECASE),
}

FORBIDDEN_PATH = {
    "internal agent log": re.compile(r"(?:^|/)Agent\.md$"),
    "dated internal implementation plan": re.compile(r"^deploy/docs/superpowers/"),
    "migrated runtime filename": re.compile(r"(?:^|/)dramaRuntime(?:\.test)?\.ts$", re.IGNORECASE),
}

SECRET_ASSIGNMENT = re.compile(
    r"(?i)(?:api[_-]?key|secret(?:[_-]?key)?|password|access[_-]?token|refresh[_-]?token)"
    r"\s*[:=]\s*['\"]([^'\"]{8,})['\"]"
)
SAFE_PLACEHOLDER = re.compile(
    r"(?i)(?:example|placeholder|change[-_ ]?me|your[-_ ]|test[-_ ]|dummy|\$\{|<[^>]+>)"
)

SKIPPED_PREFIXES = (
    "deploy/dist/",
    "studio/dist/",
)
SKIPPED_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2",
    ".mp3", ".wav", ".mp4", ".zip", ".pdf", ".pyc",
)

# Applied migrations are immutable because their bytes are recorded in the
# migration ledger. They are isolated here until a clean baseline is selected;
# changing even a comment would make existing installations fail checksum
# verification.
IMMUTABLE_MIGRATION_PATH = re.compile(
    r"^deploy/(?:sql/)?(?:database_schema|db_migration_[^/]+)\.sql$",
    re.IGNORECASE,
)


def _tracked_paths(root: Path) -> Iterable[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    for raw_path in result.stdout.split(b"\0"):
        if raw_path:
            yield raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")


def _is_skipped(path: str) -> bool:
    lowered = path.lower()
    return (
        path == SELF_PATH
        or path.startswith(SKIPPED_PREFIXES)
        or lowered.endswith(SKIPPED_SUFFIXES)
    )


def scan_repository(root: Path = REPOSITORY_ROOT) -> list[HygieneIssue]:
    """Return tracked-file violations without printing matched source text."""
    issues: list[HygieneIssue] = []
    for path in _tracked_paths(root):
        file_path = root / Path(path)
        # A rename is represented as a missing tracked path plus a new untracked
        # path until it is staged. Scan the effective working tree, not the stale
        # index entry, so contributors can run the gate before staging.
        if not file_path.exists():
            continue
        for rule, pattern in FORBIDDEN_PATH.items():
            if pattern.search(path):
                issues.append(HygieneIssue(path=path, line=0, rule=rule))
        if _is_skipped(path):
            continue
        try:
            text = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            for rule, pattern in FORBIDDEN_CONTENT.items():
                if rule == "legacy product identifier" and IMMUTABLE_MIGRATION_PATH.match(path):
                    continue
                if pattern.search(line):
                    issues.append(HygieneIssue(path=path, line=line_number, rule=rule))
            for match in SECRET_ASSIGNMENT.finditer(line):
                if not SAFE_PLACEHOLDER.search(match.group(1)):
                    issues.append(HygieneIssue(path=path, line=line_number, rule="possible committed credential"))
    return issues


def main() -> int:
    issues = scan_repository()
    if issues:
        print(f"Open-source hygiene failed: {len(issues)} issue(s)")
        for issue in issues:
            location = f"{issue.path}:{issue.line}" if issue.line else issue.path
            print(f"- {location} [{issue.rule}]")
        return 1
    print("Open-source hygiene OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
