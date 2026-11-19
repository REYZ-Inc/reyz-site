#!/usr/bin/env bash
# Historical brand study. Write archival renders to the frame directory.
# Usage: bash tools/render_brand_motion.sh /tmp/reyz-brand-motion
# To encode an already completed 0..119 sequence: add --encode-only.
set -euo pipefail
cd "$(dirname "$0")/.."

reyz_frames="${1:?Pass a directory for the 120 rendered PNG frames}"
reyz_mode="${2:-render}"
reyz_video_tmp="$reyz_frames/infinity-motion.partial.mp4"
reyz_poster_tmp="$reyz_frames/infinity-motion.partial.webp"
trap 'rm -f "$reyz_video_tmp" "$reyz_poster_tmp"' EXIT
if [[ "$reyz_mode" != "render" && "$reyz_mode" != "--encode-only" ]]; then
  echo "Expected no second argument, or --encode-only" >&2
  exit 2
fi
if [[ "$reyz_mode" == "render" ]]; then
  blender -b --python tools/render_brand.py -- \
    --out "$reyz_frames" --frames 120 --width 1280 --samples 16
fi

python3 - "$reyz_frames" <<'PY'
from pathlib import Path
import sys
from PIL import Image
frames = Path(sys.argv[1])
missing = [f'{i:04d}.png' for i in range(120) if not (frames / f'{i:04d}.png').is_file()]
if missing:
    raise SystemExit('Missing rendered frames: ' + ', '.join(missing))
for i in range(120):
    with Image.open(frames / f'{i:04d}.png') as image:
        if image.size != (1280, 720):
            raise SystemExit(f'Unexpected frame dimensions at {i}: {image.size}')
        image.verify()
PY

ffmpeg -hide_banner -loglevel error -y \
  -framerate 24 -start_number 0 -i "$reyz_frames/%04d.png" -frames:v 120 \
  -vf 'scale=1280:720:flags=lanczos:out_color_matrix=bt709,format=yuv420p' \
  -c:v libx264 -preset slow -crf 20 -profile:v high -level:v 3.1 \
  -threads 2 \
  -maxrate 3000k -bufsize 6000k -g 120 -keyint_min 120 -sc_threshold 0 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -an -movflags +faststart "$reyz_video_tmp"

# The fallback poster comes from the encoded first frame, so the image and
# the first decoded video frame have the same composition and color conversion.
ffmpeg -hide_banner -loglevel error -y \
  -i "$reyz_video_tmp" -frames:v 1 \
  -c:v libwebp -quality 90 -compression_level 6 -threads 1 -f image2 -update 1 \
  "$reyz_poster_tmp"

ffmpeg -hide_banner -v error -i "$reyz_video_tmp" -f null -
python3 - "$reyz_video_tmp" "$reyz_poster_tmp" <<'PY'
from pathlib import Path
import hashlib
import json
import sys
video, poster = map(Path, sys.argv[1:])
if video.stat().st_size > 2_000_000:
    raise SystemExit('Video exceeds the 2 MB delivery budget; inspect before publishing')
video = video.replace(video.with_name('infinity-motion.mp4'))
poster = poster.replace(poster.with_name('infinity-motion.webp'))
for path in [video, poster]:
    print(json.dumps({'path': str(path), 'bytes': path.stat().st_size,
                      'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}))
PY
