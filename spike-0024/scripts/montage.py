# SPDX-License-Identifier: AGPL-3.0-or-later
# Spike 0024: stack screenshots (each scaled to a width) into one labelled image, for looking at.
# usage: python3 -I montage.py out.jpg width file...
import sys
from PIL import Image, ImageDraw
out, width, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
tiles = []
for f in files:
    im = Image.open(f).convert('RGB')
    im = im.resize((width, round(im.height * width / im.width)))
    ImageDraw.Draw(im).text((6, 4), f.split('/')[-1], fill=(255, 255, 0))
    tiles.append(im)
sheet = Image.new('RGB', (width, sum(t.height for t in tiles)))
y = 0
for t in tiles:
    sheet.paste(t, (0, y)); y += t.height
sheet.save(out, quality=72)
