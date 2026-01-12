import pandas as pd
import os
import xml.etree.ElementTree as ET
import base64
import io
from PIL import Image

NODE_FILE = "school-nav-data/nodes/nodes_ground.csv"
SVG_FILE = "school-nav-data/svg/ground-level-nodes.svg"

def examine():
    # 1. Check Node Coordinates
    if os.path.exists(NODE_FILE):
        df = pd.read_csv(NODE_FILE)
        print(f"Nodes X range: {df['x'].min()} - {df['x'].max()}")
        print(f"Nodes Y range: {df['y'].min()} - {df['y'].max()}")
    else:
        print("Node file not found.")

    # 2. Check SVG and Image
    if os.path.exists(SVG_FILE):
        tree = ET.parse(SVG_FILE)
        root = tree.getroot()
        
        # Get viewBox
        viewbox = root.get('viewBox')
        width = root.get('width')
        height = root.get('height')
        print(f"SVG viewBox: {viewbox}")
        print(f"SVG width/height: {width} / {height}")
        
        # Get Image
        ns = {'svg': 'http://www.w3.org/2000/svg', 'xlink': 'http://www.w3.org/1999/xlink'}
        image_elem = root.find(".//svg:image", ns)
        if image_elem is None: image_elem = root.find(".//image")
        
        if image_elem is not None:
            img_w = image_elem.get('width')
            img_h = image_elem.get('height')
            print(f"Image Tag width/height: {img_w} / {img_h}")
            
            href = image_elem.get(f"{{{ns['xlink']}}}href")
            if not href: href = image_elem.get('href')
            
            if href and href.startswith('data:image'):
                header, b64_data = href.split(',', 1)
                img_data = base64.b64decode(b64_data)
                pil_img = Image.open(io.BytesIO(img_data))
                print(f"PIL Image Actual Size: {pil_img.size}")
            else:
                print("No embedded base64 image found.")
        else:
            print("No image tag found.")

if __name__ == "__main__":
    examine()
