import pandas as pd
import math
import os
import io
import base64
import xml.etree.ElementTree as ET
from PIL import Image

# ---------------- CONFIG ----------------
NODE_DIR = "school-nav-data/nodes"
SVG_DIR = "school-nav-data/svg"
OUTPUT_EDGES = "school-nav-data/edges_all.csv"

# Map floor IDs to their CSV and SVG files
floors = {
    "G": {"csv": "nodes_ground.csv", "svg": "ground-level-nodes.svg"},
    "1": {"csv": "nodes_first.csv", "svg": "first-level-nodes.svg"},
    "2": {"csv": "nodes_second.csv", "svg": "second-level-nodes.svg"},
    "3": {"csv": "nodes_third.csv", "svg": "third-level-nodes.svg"}
}

# Widen limit: connect all visible nodes within this range
MAX_DIST = 150  
# Number of nearest neighbors to connect (for Rooms/Stairs)
ROOM_NEIGHBORS = 2
# For corridors, we ignore a fixed count and rely on MAX_DIST + Line of Sight

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

def load_floor_image(svg_filename):
    """Parses SVG to find embedded base64 image and returns PIL Image and SVG dimensions."""
    path = os.path.join(SVG_DIR, svg_filename)
    if not os.path.exists(path):
        print(f"⚠️ Missing SVG {path}")
        return None, (1, 1)
    
    try:
        tree = ET.parse(path)
        root = tree.getroot()
        
        # Get SVG dimensions from viewBox or width/height attributes
        # viewBox format: "min-x min-y width height"
        viewbox = root.get('viewBox')
        svg_w, svg_h = 1000, 1000 # default fallback
        
        if viewbox:
            parts = viewbox.split()
            if len(parts) == 4:
                svg_w = float(parts[2])
                svg_h = float(parts[3])
        else:
            w_str = root.get('width')
            h_str = root.get('height')
            if w_str and h_str:
                # Remove 'px' or other units if present
                svg_w = float("".join(c for c in w_str if c.isdigit() or c == '.'))
                svg_h = float("".join(c for c in h_str if c.isdigit() or c == '.'))

        # Namespaces often used in Inkscape/Standard SVGs
        ns = {
            'svg': 'http://www.w3.org/2000/svg', 
            'xlink': 'http://www.w3.org/1999/xlink'
        }
        
        # Try finding image with namespace
        image_elem = root.find(".//svg:image", ns)
        if image_elem is None:
             image_elem = root.find(".//image")
        
        if image_elem is not None:
            # Check xlink:href or href
            href = image_elem.get(f"{{{ns['xlink']}}}href")
            if not href:
                href = image_elem.get('href')
            
            if href and href.startswith('data:image'):
                # Extract base64 payload
                # Format: data:image/png;base64,......
                try:
                    header, b64_data = href.split(',', 1)
                    image_data = base64.b64decode(b64_data)
                    img = Image.open(io.BytesIO(image_data))
                    # Ensure RGB or Grayscale
                    if img.mode not in ('RGB', 'L'):
                        img = img.convert('RGB')
                    return img, (svg_w, svg_h)
                except Exception as b64_err:
                    print(f"Failed to decode base64 image in {svg_filename}: {b64_err}")
    except Exception as e:
        print(f"Error parsing SVG {path}: {e}")
    
    return None, (1, 1)

def has_collision(a, b, image, scale=(1, 1), collision_desc="wall"):
    """
    Checks if the line segment between a and b intersects with dark pixels in the image.
    Scale tuple (scale_x, scale_y) converts node coords to pixel coords.
    Returns True if collision detected.
    """
    if image is None: 
        return False
    
    sx, sy = scale
    x1, y1 = int(a["x"] * sx), int(a["y"] * sy)
    x2, y2 = int(b["x"] * sx), int(b["y"] * sy)
    
    # Check bounds
    w, h = image.size
    # Clamp is safer than rejecting? No, if out of bounds, it's not a valid map area usually.
    # But let's reject if fully out.
    if (x1 < 0 or x1 >= w or y1 < 0 or y1 >= h) and (x2 < 0 or x2 >= w or y2 < 0 or y2 >= h):
        return False

    # Get sample points along the line
    dx = abs(x2 - x1)
    dy = abs(y2 - y1)
    
    # Bresenham's algo to generate points
    # Standard implementation
    steep = abs(dy) > abs(dx)
    if steep:
        x1, y1 = y1, x1
        x2, y2 = y2, x2
    
    if x1 > x2:
        x1, x2 = x2, x1
        y1, y2 = y2, y1
        
    dx = x2 - x1
    dy = abs(y2 - y1)
    error = dx / 2.0
    ystep = 1 if y1 < y2 else -1
    y = y1
    
    path_pixels = []
    for x in range(x1, x2 + 1):
        coord = (y, x) if steep else (x, y)
        path_pixels.append(coord)
        error -= dy
        if error < 0:
            y += ystep
            error += dx

    # Check pixels for darkness (walls)
    # Skip start and end slightly to avoid the node marker itself if present/dark
    # We rely on image resolution being high enough that a few pixels skip doesn't miss walls
    margin = 5 # skip 5 pixels at ends
    if len(path_pixels) <= margin * 2:
        check_pixels = path_pixels
    else:
        check_pixels = path_pixels[margin:-margin]
        
    consecutive_hits = 0
    # Threshold for "darkness". 0 is black, 255 is white.
    # Walls are black lines. 
    DARK_THRESHOLD = 100 
    
    pixels = image.load()
    
    for px, py in check_pixels:
        if 0 <= px < w and 0 <= py < h:
            val = pixels[px, py]
            # Convert to brightness if RGB
            if isinstance(val, tuple):
                # Averaging RGB
                brightness = sum(val[:3]) / 3
            else:
                brightness = val
            
            if brightness < DARK_THRESHOLD:
                consecutive_hits += 1
                # If we see a few consecutive dark pixels, treat as wall
                if consecutive_hits >= 3: # 3 pixels thick wall check
                    return True
            else:
                consecutive_hits = 0
                
    return False

# ---------------- MAIN ----------------
all_edges = []
all_nodes = []

for floor_key, file_info in floors.items():
    csv_file = file_info["csv"]
    svg_file = file_info["svg"]
    
    csv_path = os.path.join(NODE_DIR, csv_file)
    if not os.path.exists(csv_path):
        print(f"⚠️ Missing node file {csv_path}")
        continue
        
    df = pd.read_csv(csv_path)
    df["floor"] = floor_key
    
    # Load floor plan image for collision checking
    print(f"Loading image for {floor_key} from {svg_file}...")
    floor_image, svg_dim = load_floor_image(svg_file)
    
    scale_factors = (1, 1)
    if floor_image:
        img_w, img_h = floor_image.size
        svg_w, svg_h = svg_dim
        scale_x = img_w / svg_w if svg_w else 1
        scale_y = img_h / svg_h if svg_h else 1
        scale_factors = (scale_x, scale_y)
        print(f"  Image: {img_w}x{img_h} px, SVG: {svg_w}x{svg_h} units. Scale: {scale_x:.2f}, {scale_y:.2f}")
    else:
        print("  ⚠️ No image loaded, wall collision detection will be skipped for this floor.")

    # Convert to list of dicts for easier iteration
    corridors = df[df["type"] == "corridor"].to_dict("records")
    rooms = df[df["type"] == "room"].to_dict("records")
    stairs = df[df["type"] == "stair"].to_dict("records")
    lifts = df[df["type"] == "lift"].to_dict("records")
    
    # 1. Rooms → Nearest Corridors
    # Rooms must check collision too (don't link through a wall)
    for r in rooms:
        # Find candidates by distance
        candidates = sorted(corridors, key=lambda c: distance(r, c))
        
        connected_count = 0
        for cand in candidates:
            dist = distance(r, cand)
            if dist > MAX_DIST: 
                break # heuristic cut-off
            
            # Check collision
            if has_collision(r, cand, floor_image, scale=scale_factors):
                continue
                
            all_edges.append(connect(r, cand))
            all_edges.append(connect(cand, r))
            connected_count += 1
            if connected_count >= ROOM_NEIGHBORS:
                break
                
    # 2. Corridors → Neighbors in range (Line of Sight)
    # We want to form a dense graph but valid one.
    print(f"  Processing {len(corridors)} corridor nodes...")
    for i, c in enumerate(corridors):
        for o in corridors:
            if c["id"] == o["id"]:
                continue
            
            dist = distance(c, o)
            if dist <= MAX_DIST:
                # Check collision (Line of Sight)
                if not has_collision(c, o, floor_image, scale=scale_factors):
                     all_edges.append(connect(c, o))

    # 3. Stairs/Lifts → Nearest Corridors
    for s in stairs + lifts:
        candidates = sorted(corridors, key=lambda c: distance(s, c))
        connected_count = 0
        for cand in candidates:
            # slightly larger leeway for stairs?
            if distance(s, cand) > MAX_DIST + 20:
                break
                
            if has_collision(s, cand, floor_image, scale=scale_factors):
                continue
            
            all_edges.append(connect(s, cand))
            all_edges.append(connect(cand, s))
            connected_count += 1
            if connected_count >= 1: 
                break
                
    # Add to global nodes list for vertical processing
    all_nodes.append(df)

# Global concat for vertical steps
if all_nodes:
    nodes = pd.concat(all_nodes, ignore_index=True)
else:
    nodes = pd.DataFrame()

# ---------------- VERTICAL EDGES ----------------
# (Keep existing vertical logic)
if not nodes.empty:
    print("Linking vertical connections...")
    
    def vertical_links(nodes, typ):
        by_id = {}
        for _, n in nodes.iterrows():
            if n["type"] != typ:
                continue
            # normalize e.g. stair_gf_5 → stair_5 
            # (Assuming naming convention holds)
            base = "".join([ch for ch in n["id"] if ch.isdigit()])
            if not base:
                # fallback: try splitting by floor part
                # e.g. stair_gf_5 -> split by '_' -> take last
                parts = n["id"].split('_')
                if len(parts) > 1: base = parts[-1]
            
            if not base: continue
            
            key = f"{typ}_{base}"
            by_id.setdefault(key, []).append(n)
            
        for group in by_id.values():
            if len(group) < 2:
                continue
            # sort by floor index? 
            # We need a proper floor order map
            floor_order = {"G": 0, "1": 1, "2": 2, "3": 3}
            group = sorted(group, key=lambda x: floor_order.get(str(x["floor"]), 99))
            
            for i in range(len(group) - 1):
                a, b = group[i], group[i + 1]
                all_edges.append({
                    "from": a["id"],
                    "to": b["id"],
                    "distance": 0, # Vertical movement cost?
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
if all_edges:
    edges_df = pd.DataFrame(all_edges).drop_duplicates(subset=["from", "to"])
    os.makedirs(os.path.dirname(OUTPUT_EDGES), exist_ok=True)
    edges_df.to_csv(OUTPUT_EDGES, index=False)
    print(f"✅ Generated {len(edges_df)} edges → {OUTPUT_EDGES}")
else:
    print("❌ No edges generated.")
