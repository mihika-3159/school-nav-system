#!/usr/bin/env python3
"""
Regenerate edges_all.csv from node positions.

Rules:
- Within each floor:
  * Connect every corridor to its 3 nearest corridors (bidirectional).
  * Connect every non-corridor node (room/entrance/lift/stair/other) to its 2 nearest corridors (bidirectional).
- Cross-floor:
  * Connect stairs that share the same numeric suffix (e.g., stair_gf_1, stair_ff_1, stair_sf_1) across all floors (bidirectional, accessible=false).
  * Connect lifts with the same base id prefix ("lift") across all floors (bidirectional, accessible=true).
- Distances are Euclidean on the node coordinates; cross-floor connectors reuse the planar distance between points.
"""
from __future__ import annotations

import csv
import math
import re
from collections import defaultdict
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODES_CSV = ROOT / "school-nav-data" / "nodes_all.csv"
EDGES_CSV = ROOT / "school-nav-data" / "edges_all.csv"

CORRIDOR_NEIGHBORS = 5
NODE_TO_CORRIDOR_NEIGHBORS = 3
OUTSIDE_NODE_IDS = {
    # nodes physically outside campus; must connect via entrances
    "room_gf_10",   # Canteen
    "room_gf_101",  # Multipurpose Hall
    "room_gf_104",  # Main Canteen
    "room_gf_108",  # Main Field
    "room_gf_125",  # Bus Bay
}


def load_nodes():
    nodes = {}
    with NODES_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            row = {k: v.strip() for k, v in row.items()}
            row["x"] = float(row["x"])
            row["y"] = float(row["y"])
            nodes[row["id"]] = row
    return nodes


def euclid(a, b, nodes):
    A, B = nodes[a], nodes[b]
    return math.hypot(A["x"] - B["x"], A["y"] - B["y"])


def add_edge(edges, a, b, dist, accessible=True):
    key = tuple(sorted((a, b)))
    existing = edges.get(key)
    if existing is None or dist < existing[0]:
        edges[key] = (dist, accessible)


def nearest(target, candidates, nodes, k):
    return sorted(((euclid(target, c, nodes), c) for c in candidates), key=lambda x: x[0])[:k]


def connect_components(floor_nodes, edges, nodes):
    """Ensure all nodes on a floor are connected by stitching closest corridors between components."""
    adj = defaultdict(set)
    for (a, b), _ in edges.items():
        if nodes[a]["floor"] != nodes[b]["floor"]:
            continue
        adj[a].add(b)
        adj[b].add(a)

    remaining = set(floor_nodes)
    components = []
    while remaining:
        start = remaining.pop()
        stack = [start]
        comp = {start}
        while stack:
            u = stack.pop()
            for v in adj.get(u, []):
                if v not in comp:
                    comp.add(v)
                    remaining.discard(v)
                    stack.append(v)
        components.append(comp)

    if len(components) <= 1:
        return

    # Use corridors to stitch components; fall back to any node if needed
    corridors = [n for n in floor_nodes if nodes[n]["type"] == "corridor"]
    comp_corridors = []
    for comp in components:
        subset = [n for n in comp if n in corridors]
        comp_corridors.append(subset if subset else list(comp))

    base = comp_corridors[0]
    for subset in comp_corridors[1:]:
        best = None
        for a in base:
            for b in subset:
                d = euclid(a, b, nodes)
                if best is None or d < best[0]:
                    best = (d, a, b)
        if best:
            _, a, b = best
            add_edge(edges, a, b, euclid(a, b, nodes), accessible=True)
            base += subset


def main():
    nodes = load_nodes()
    edges = {}

    # Group nodes by floor and by type
    by_floor = defaultdict(list)
    for nid, data in nodes.items():
        by_floor[data["floor"]].append(nid)

    for floor, ids in by_floor.items():
        corridors = [nid for nid in ids if nodes[nid]["type"] == "corridor"]
        entrances = [nid for nid in ids if nodes[nid]["type"] == "entrance"]
        non_corridors = [nid for nid in ids if nodes[nid]["type"] != "corridor"]

        # corridor <-> corridor
        for cid in corridors:
            for dist, other in nearest(cid, [c for c in corridors if c != cid], nodes, CORRIDOR_NEIGHBORS):
                add_edge(edges, cid, other, dist, accessible=True)

        # node -> corridor
        for nid in non_corridors:
            if not corridors:
                continue
            if nid in OUTSIDE_NODE_IDS and entrances:
                # Outside nodes must enter via entrances first.
                for dist, ent in nearest(nid, entrances, nodes, NODE_TO_CORRIDOR_NEIGHBORS):
                    add_edge(edges, nid, ent, dist, accessible=True)
            else:
                for dist, cid in nearest(nid, corridors, nodes, NODE_TO_CORRIDOR_NEIGHBORS):
                    # stairs marked inaccessible, others accessible
                    accessible = nodes[nid]["type"] != "stair"
                    add_edge(edges, nid, cid, dist, accessible=accessible)

        # ensure intra-floor connectivity by stitching components
        connect_components(ids, edges, nodes)

    # Cross-floor connectors: stairs grouped by numeric suffix
    stair_groups = defaultdict(list)
    lift_groups = defaultdict(list)

    for nid, data in nodes.items():
        if "stair" in data["type"]:
            m = re.search(r"(\\d+)$", nid)
            key = m.group(1) if m else nid
            stair_groups[key].append(nid)
        if data["type"] == "lift":
            # group all lifts together to link across floors
            lift_groups["lift"].append(nid)

    for group in stair_groups.values():
        if len(group) < 2:
            continue
        for a, b in combinations(group, 2):
            add_edge(edges, a, b, euclid(a, b, nodes), accessible=False)

    for group in lift_groups.values():
        if len(group) < 2:
            continue
        for a, b in combinations(group, 2):
            add_edge(edges, a, b, euclid(a, b, nodes), accessible=True)

    # Write edges (both directions)
    rows = []
    for (a, b), (dist, accessible) in edges.items():
        rows.append({"from": a, "to": b, "distance": f"{dist:.2f}", "accessible": str(accessible).lower()})
        rows.append({"from": b, "to": a, "distance": f"{dist:.2f}", "accessible": str(accessible).lower()})

    rows.sort(key=lambda r: (r["from"], r["to"]))

    with EDGES_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["from", "to", "distance", "accessible"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} directed edges ({len(edges)} undirected).")


if __name__ == "__main__":
    main()
