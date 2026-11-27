# Redraws a logged frame as a picture. Glow is left out; this is only to
# check shapes and positions.
import json, sys
from PIL import Image, ImageDraw
log = json.load(open(sys.argv[1]))
img = Image.new("RGB", (1280, 720), "#050506"); d = ImageDraw.Draw(img)
path = []
for cmd in log:
    name, st = cmd[0], cmd[-1]; a = cmd[1:-1]
    if name == "beginPath": path = []
    elif name == "moveTo": path.append(("m", a[0], a[1]))
    elif name == "lineTo": path.append(("l", a[0], a[1]))
    elif name == "arc": path.append(("arc", a[0], a[1], a[2]))
    elif name == "stroke":
        cur = None
        for p in path:
            if p[0] == "m": cur = (p[1], p[2])
            elif p[0] == "l" and cur:
                d.line([cur, (p[1], p[2])], fill=st.get("strokeStyle", "#fff"), width=max(1, round(st.get("lineWidth", 1)))); cur = (p[1], p[2])
    elif name == "fill":
        for p in path:
            if p[0] == "arc": d.ellipse([p[1]-p[3], p[2]-p[3], p[1]+p[3], p[2]+p[3]], fill=st.get("fillStyle", "#fff"))
    elif name == "fillText":
        d.text((a[1] if st.get("textAlign") == "left" else a[1] - 4 * len(str(a[0])), a[2] - (14 if st.get("textBaseline") == "bottom" else 0)), str(a[0]), fill=st.get("fillStyle", "#fff"))
img.save(sys.argv[2])
