import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
# (source file, output id, crop box in source pixels or None, target size)
JOBS = [
    ("Grand_prismatic_spring.jpg", "spring", (361, 0, 1638, 1277), (256, 256)),
    ("Brightly_lit_STS-135_on_launch_pad_39a.jpg", "shuttle", (1000, 0, 3672, 2672), (256, 256)),
    ("Doge_homemade_meme.jpg", "doge", None, None),
    ("Farmer_meme_with_apostrophe.jpg", "honest-work", None, None),
]
for f, id_, box, size in JOBS:
    im = Image.open(f"{src}/{f}").convert("RGB")
    if box:
        im = im.crop(box)
    if size is None:
        s = 320 / max(im.size)
        size = (round(im.size[0] * s), round(im.size[1] * s))
    im = im.resize(size, Image.LANCZOS)
    im.save(f"{out}/{id_}.png", optimize=True)
    print(id_, im.size)
