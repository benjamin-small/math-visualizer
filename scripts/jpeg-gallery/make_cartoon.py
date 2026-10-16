"""Draw the lab's original cartoon meme: flat colours, bold outlines, meme captions."""
import sys
from PIL import Image, ImageDraw, ImageFont

K = 3                     # supersampling factor
W, H = 320, 240
img = Image.new("RGB", (W * K, H * K), "#7cc6e8")
d = ImageDraw.Draw(img)
s = lambda *v: [x * K for x in v]
OUT = 4 * K               # outline width

# ground
d.ellipse(s(-80, 170, 400, 400), fill="#6cbf4a", outline="black", width=OUT)
# a sun
d.ellipse(s(266, 50, 310, 94), fill="#ffd84a", outline="black", width=OUT)
# the blob mascot
d.ellipse(s(70, 70, 210, 205), fill="#f39a35", outline="black", width=OUT)
# eyes
for ex in (112, 160):
    d.ellipse(s(ex - 17, 100, ex + 17, 138), fill="white", outline="black", width=OUT)
    d.ellipse(s(ex - 6, 114, ex + 6, 130), fill="black")
# grin
d.arc(s(105, 128, 175, 178), start=20, end=160, fill="black", width=OUT)
# the photo it is proudly holding: 4×4 blocky squares, a JPEG pun
px, py, cell = 192, 118, 13
d.rectangle(s(px - 6, py - 6, px + 4 * cell + 6, py + 4 * cell + 6), fill="white", outline="black", width=OUT)
colours = ["#d9534f", "#f0ad4e", "#5cb85c", "#5bc0de", "#f0ad4e", "#d9534f", "#5bc0de", "#5cb85c",
           "#5cb85c", "#5bc0de", "#d9534f", "#f0ad4e", "#5bc0de", "#5cb85c", "#f0ad4e", "#d9534f"]
for i, c in enumerate(colours):
    x, y = px + (i % 4) * cell, py + (i // 4) * cell
    d.rectangle(s(x, y, x + cell, y + cell), fill=c)

font = ImageFont.truetype(sys.argv[2], 34 * K)
def caption(text, y):
    w = d.textlength(text, font=font)
    d.text(((W * K - w) / 2, y * K), text, font=font, fill="white", stroke_width=3 * K, stroke_fill="black")
caption("SAVED IT AS JPEG", 4)
caption("NEEDS MORE JPEG", 192)

img.resize((W, H), Image.LANCZOS).save(sys.argv[1], optimize=True)
