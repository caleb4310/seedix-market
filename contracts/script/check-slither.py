#!/usr/bin/env python3
"""Fail when Slither reports a high or medium finding that is not triaged."""

import json
import sys
from pathlib import Path

if len(sys.argv) != 3:
    print("usage: check-slither.py slither.json docs/slither-triage.md", file=sys.stderr)
    sys.exit(2)

report = json.loads(Path(sys.argv[1]).read_text())
triage = Path(sys.argv[2]).read_text()
accepted = set()
for line in triage.splitlines():
    text = line.strip()
    if text.startswith("- "):
        accepted.add(text[2:].split(" | ", 1)[0].strip())

results_obj = report.get("results", {})
if not isinstance(results_obj, dict) or "detectors" not in results_obj:
    print("Slither JSON has no detector list. The run did not produce a report.", file=sys.stderr)
    sys.exit(1)
results = results_obj["detectors"]

open_findings = []
for item in results:
    impact = str(item.get("impact", "")).lower()
    if impact not in {"high", "medium"}:
        continue
    check = item.get("check", "unknown")
    elements = item.get("elements") or []
    places = []
    for element in elements:
        source = element.get("source_mapping") or {}
        filename = source.get("filename_relative") or source.get("filename_short") or ""
        if filename.startswith("src/"):
            lines = source.get("lines") or []
            line = lines[0] if lines else "?"
            places.append(f"{filename}:{line}")
    key = check if not places else f"{check} {places[0]}"
    if check in accepted or key in accepted:
        continue
    where = ", ".join(places[:3]) if places else "no src location"
    open_findings.append(f"{impact} {check}: {where}")

if open_findings:
    print("Untriaged Slither high/medium findings:")
    for finding in open_findings:
        print(finding)
    sys.exit(1)

print(f"Slither high/medium findings are triaged ({len(accepted)} accepted checks).")
