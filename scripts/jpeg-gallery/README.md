# JPEG lab gallery scripts

These scripts regenerate the bundled gallery pictures in `web/public/jpeg/`. The credits and source URLs are in `web/public/jpeg/CREDITS.md`. Nothing here runs in the app or in CI.

Requirements: Python 3 with Pillow (`pip install pillow`).

## 1. Download the four Commons originals

Save these four files, under the same names, into one folder (`<src-dir>`). Each link is the file page; use its original-file download.

- `Grand_prismatic_spring.jpg`: https://commons.wikimedia.org/wiki/File:Grand_prismatic_spring.jpg
- `Brightly_lit_STS-135_on_launch_pad_39a.jpg`: https://commons.wikimedia.org/wiki/File:Brightly_lit_STS-135_on_launch_pad_39a.jpg
- `Doge_homemade_meme.jpg`: https://commons.wikimedia.org/wiki/File:Doge_homemade_meme.jpg
- `Farmer_meme_with_apostrophe.jpg`: https://commons.wikimedia.org/wiki/File:Farmer_meme_with_apostrophe.jpg

## 2. Make the four scaled pictures

```bash
python3 make_gallery.py <src-dir> <out-dir>
```

This writes `spring.png`, `shuttle.png`, `doge.png` and `honest-work.png` to `<out-dir>`. spring and shuttle are cropped and resized to 256 × 256; doge and honest-work are resized so the long side is 320 px. The script also writes a raw `.rgba` file beside each PNG. The app does not use these, so delete them rather than commit them.

## 3. Draw the cartoon

```bash
python3 make_cartoon.py <out-dir>/cartoon.png <Impact.ttf>
```

This draws `cartoon.png` (320 × 240) with the captions set in Impact. The font is only used to render the picture. Do not commit the font file.

## 4. Copy into the app

Copy the five PNGs into `web/public/jpeg/`. Check each file is at most 150,000 bytes, since the app loads them as bundled assets.
