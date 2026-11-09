#!/usr/bin/env python3
"""Fail when Slither reports a high or medium finding that is not triaged.

Keys are `detector Contract.function`, never source line numbers.
"""

import json
import sys
from pathlib import Path


def function_key(element):
    current = element
    seen = set()
    while isinstance(current, dict) and id(current) not in seen:
        seen.add(id(current))
        if current.get("type") == "function":
            parent = (current.get("type_specific_fields") or {}).get("parent") or {}
            contract = parent.get("name") if parent.get("type") == "contract" else None
            name = current.get("name")
            if contract and name:
                return f"{contract}.{name}"
        current = (current.get("type_specific_fields") or {}).get("parent")
    return None


def finding_key(item):
    check = item.get("check", "unknown")
    for element in item.get("elements") or []:
        fn = function_key(element)
        if fn:
            return f"{check} {fn}"
    return None


def load_triage(path):
    accepted = {}
    duplicates = []
    for line in Path(path).read_text().splitlines():
        text = line.strip()
        if not text.startswith("- "):
            continue
        body = text[2:]
        key, _, reason = body.partition(" | ")
        key = key.strip()
        reason = reason.strip()
        if not key or not reason:
            print(f"Triage line needs a key and a justification: {text}", file=sys.stderr)
            sys.exit(1)
        if key in accepted:
            duplicates.append(key)
        accepted[key] = reason
    if duplicates:
        print("Duplicate triage keys:", file=sys.stderr)
        for key in duplicates:
            print(key, file=sys.stderr)
        sys.exit(1)
    return accepted


def main():
    if len(sys.argv) != 3:
        print("usage: check-slither.py slither.json docs/slither-triage.md", file=sys.stderr)
        sys.exit(2)
    report = json.loads(Path(sys.argv[1]).read_text())
    accepted = load_triage(sys.argv[2])
    results_obj = report.get("results", {})
    if not isinstance(results_obj, dict) or "detectors" not in results_obj:
        print("Slither JSON has no detector list. The run did not produce a report.", file=sys.stderr)
        sys.exit(1)

    open_findings = []
    seen = set()
    for item in results_obj["detectors"]:
        impact = str(item.get("impact", "")).lower()
        if impact not in {"high", "medium"}:
            continue
        key = finding_key(item)
        if key is None:
            open_findings.append(f"{impact} {item.get('check')}: no contract.function")
            continue
        if key in seen:
            continue
        seen.add(key)
        if key not in accepted:
            open_findings.append(f"{impact} {key}")

    if open_findings:
        print("Untriaged Slither high/medium findings:")
        for finding in open_findings:
            print(finding)
        sys.exit(1)
    print(f"Slither high/medium findings are triaged ({len(accepted)} accepted keys, {len(seen)} in this run).")


if __name__ == "__main__":
    main()
