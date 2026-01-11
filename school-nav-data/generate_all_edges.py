import pandas as pd
import math
import os
from itertools import combinations

# ---------------- CONFIG ----------------
NODE_DIR = "nodes"
OUTPUT_EDGES = "school-nav-data/edges_all.csv"

floors = {
    "G": "nodes_ground.csv",
    "1": "nodes_first.csv",
    "2": "nodes_second.csv",
    "3": "nodes_third.csv"
}

# maximum distance for same-floor connections
# maximum distance for same-floor connections
MAX_DIST = 45
# number of nearest corridor nodes to connect to
ROOM_NEIGHBORS = 2
CORRIDOR_NEIGHBORS = 2

# ---------------- HELPERS ----------------
def distance(a, b):
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])

def connect(a, b, accessible="true"):
    return {
        "from": a["id"],
        "to": b["id"],
        "distance": round(distance(a, b), 2),
        "accessible": accessible
    }

# ---------------- MAIN ----------------
all_edges = []
all_nodes = []

for floor, file in floors.items():
    path = os.path.join(NODE_DIR, file)
    if not os.path.exists(path):
        print(f"⚠️ Missing file {path}")
        continue
    df = pd.read_csv(path)
    df["floor"] = floor
    all_nodes.append(df)

nodes = pd.concat(all_nodes, ignore_index=True)

# group nodes by floor
for floor, df in nodes.groupby("floor"):
    df = df.reset_index(drop=True)
    print(f"Processing floor {floor} with {len(df)} nodes")

    corridors = df[df["type"] == "corridor"].to_dict("records")
    rooms = df[df["type"] == "room"].to_dict("records")
    stairs = df[df["type"] == "stair"].to_dict("records")
    lifts = df[df["type"] == "lift"].to_dict("records")

    # Rooms → nearest corridor
    for r in rooms:
        nearest = sorted(
            [c for c in corridors],
            key=lambda c: distance(r, c)
        )[:ROOM_NEIGHBORS]
        for n in nearest:
            all_edges.append(connect(r, n))
            all_edges.append(connect(n, r))

    # Corridors → nearest corridors
    for c in corridors:
        # Filter strictly by distance first to avoid wall hacks
        valid_neighbors = [
            o for o in corridors 
            if o["id"] != c["id"] and distance(c, o) <= MAX_DIST
        ]
        nearest = sorted(
            valid_neighbors,
            key=lambda o: distance(c, o)
        )[:CORRIDOR_NEIGHBORS]
        for n in nearest:
            all_edges.append(connect(c, n))
            all_edges.append(connect(n, c))

    # Stairs/Lifts → nearest corridors
    for s in stairs + lifts:
        nearest = sorted(
            [c for c in corridors if distance(s, c) <= MAX_DIST + 20], # slightly leeway for stairs
            key=lambda c: distance(s, c)
        )[:1]
        for n in nearest:
            all_edges.append(connect(s, n))
            all_edges.append(connect(n, s))

# ---------------- VERTICAL EDGES ----------------
print("Linking vertical connections...")

def vertical_links(nodes, typ):
    by_id = {}
    for _, n in nodes.iterrows():
        if n["type"] != typ:
            continue
        # normalize e.g. stair_gf_5 → stair_5
        base = "".join([ch for ch in n["id"] if ch.isdigit()])
        if not base:
            continue
        key = f"{typ}_{base}"
        by_id.setdefault(key, []).append(n)
    for group in by_id.values():
        if len(group) < 2:
            continue
        group = sorted(group, key=lambda x: x["floor"])
        for i in range(len(group) - 1):
            a, b = group[i], group[i + 1]
            all_edges.append({
                "from": a["id"],
                "to": b["id"],
                "distance": 0,
                "accessible": "true" if typ == "lift" else "false"
            })
            all_edges.append({
                "from": b["id"],
                "to": a["id"],
                "distance": 0,
                "accessible": "true" if typ == "lift" else "false"
            })

vertical_links(nodes, "stair")
vertical_links(nodes, "lift")

# ---------------- SAVE ----------------
edges_df = pd.DataFrame(all_edges).drop_duplicates(subset=["from", "to"])
os.makedirs(os.path.dirname(OUTPUT_EDGES), exist_ok=True)
edges_df.to_csv(OUTPUT_EDGES, index=False)
print(f"✅ Generated {len(edges_df)} edges → {OUTPUT_EDGES}")

