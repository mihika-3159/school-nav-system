#!/usr/bin/env python3
"""
Quick sanity checks for school navigation data.

Runs:
- Missing nodes referenced by edges
- Isolated nodes (degree 0)
- Zero/blank distances (reports count; suggest filling real distances)
- Duplicate edges (from/to) with potentially conflicting attributes
- Cross-floor edges that do not involve stairs/lifts/entrances
"""
from __future__ import annotations

import csv
import math
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODES_CSV = ROOT / "school-nav-data" / "nodes_all.csv"
EDGES_CSV = ROOT / "school-nav-data" / "edges_all.csv"

CONNECTOR_TYPES = {"stair", "stairs", "staircase", "lift", "entrance"}


def load_nodes():
    nodes = {}
    with NODES_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            node_id = row["id"].strip()
            nodes[node_id] = {
                "id": node_id,
                "floor": row["floor"].strip(),
                "type": row.get("type", "").strip().lower(),
                "name": row.get("name", "").strip(),
                "x": row.get("x", "").strip(),
                "y": row.get("y", "").strip(),
            }
    return nodes


def load_edges():
    edges = []
    with EDGES_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            edges.append(
                {
                    "from": row["from"].strip(),
                    "to": row["to"].strip(),
                    "distance": row.get("distance", "").strip(),
                    "accessible": str(row.get("accessible", "true")).strip().lower(),
                }
            )
    return edges


def main():
    nodes = load_nodes()
    edges = load_edges()

    missing_refs = []
    degree = Counter()
    zero_distance = 0
    duplicates = Counter()
    cross_floor_non_connector = []

    for e in edges:
        frm, to = e["from"], e["to"]
        if frm not in nodes or to not in nodes:
            missing_refs.append(e)
            continue

        degree[frm] += 1
        degree[to] += 1

        key = (frm, to)
        duplicates[key] += 1

        if e["distance"] in ("", "0", "0.0", "0.00"):
            zero_distance += 1

        nf, nt = nodes[frm], nodes[to]
        if nf["floor"] != nt["floor"]:
            if nf["type"] not in CONNECTOR_TYPES and nt["type"] not in CONNECTOR_TYPES:
                cross_floor_non_connector.append(
                    (frm, nf["type"], nf["floor"], to, nt["type"], nt["floor"])
                )

    isolated = [nid for nid in nodes if degree[nid] == 0]

    print("Nodes:", len(nodes))
    print("Edges:", len(edges))
    print("Missing node references:", len(missing_refs))
    if missing_refs:
        for e in missing_refs[:10]:
            print("  -", e)
        if len(missing_refs) > 10:
            print(f"  ... {len(missing_refs)-10} more")

    print("Isolated nodes (degree 0):", len(isolated))
    if isolated:
        print("  Sample:", isolated[:10])

    print("Zero/blank distance edges:", zero_distance)

    dup_list = [k for k, count in duplicates.items() if count > 1]
    print("Duplicate edge pairs:", len(dup_list))
    if dup_list:
        print("  Sample:", dup_list[:10])

    print("Cross-floor edges without connector types:", len(cross_floor_non_connector))
    if cross_floor_non_connector:
        for item in cross_floor_non_connector[:10]:
            frm, ft, ff, to, tt, tf = item
            print(f"  {frm} ({ft}, {ff}) -> {to} ({tt}, {tf})")
        if len(cross_floor_non_connector) > 10:
            print(f"  ... {len(cross_floor_non_connector)-10} more")


if __name__ == "__main__":
    main()
