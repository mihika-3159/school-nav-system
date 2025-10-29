import pandas as pd
import os

# --- CONFIG ---
DATA_DIR = "school-nav-data"
NODES_DIR = os.path.join(DATA_DIR, "nodes")
EDGES_DIR = os.path.join(DATA_DIR, "edges")
VERTICAL_EDGES_FILE = os.path.join(EDGES_DIR, "edges_vertical.csv")

OUTPUT_NODES = os.path.join(DATA_DIR, "nodes_all.csv")
OUTPUT_EDGES = os.path.join(DATA_DIR, "edges_all.csv")

# --- STEP 1: Combine all nodes ---
node_files = [
    f for f in os.listdir(NODES_DIR)
    if f.endswith(".csv") and not f.startswith("nodes_all")
]

node_dfs = []
for file in sorted(node_files):
    path = os.path.join(NODES_DIR, file)
    df = pd.read_csv(path)
    node_dfs.append(df)
    print(f"✅ Loaded {file} ({len(df)} nodes)")

if not node_dfs:
    raise FileNotFoundError("No node CSVs found in 'school-nav-data/nodes/'")

nodes_all = pd.concat(node_dfs, ignore_index=True)
nodes_all.drop_duplicates(subset=["id"], inplace=True)
nodes_all.to_csv(OUTPUT_NODES, index=False)
print(f"🎯 Combined nodes saved to {OUTPUT_NODES} ({len(nodes_all)} total)")

# --- STEP 2: Combine all edges ---
edge_files = [
    f for f in os.listdir(EDGES_DIR)
    if f.endswith(".csv") and f not in ["edges_all.csv", "edges_vertical.csv"]
]

edge_dfs = []
for file in sorted(edge_files):
    path = os.path.join(EDGES_DIR, file)
    df = pd.read_csv(path)
    edge_dfs.append(df)
    print(f"✅ Loaded {file} ({len(df)} edges)")

# Add vertical edges if they exist
if os.path.exists(VERTICAL_EDGES_FILE):
    df_vert = pd.read_csv(VERTICAL_EDGES_FILE)
    edge_dfs.append(df_vert)
    print(f"✅ Loaded vertical edges ({len(df_vert)} edges)")

if not edge_dfs:
    raise FileNotFoundError("No edge CSVs found in 'school-nav-data/edges/'")

edges_all = pd.concat(edge_dfs, ignore_index=True)
edges_all.drop_duplicates(subset=["from", "to"], inplace=True)
edges_all.to_csv(OUTPUT_EDGES, index=False)
print(f"🎯 Combined edges saved to {OUTPUT_EDGES} ({len(edges_all)} total)")

print("\n🚀 Merge complete! Your data is ready for the web app.")

