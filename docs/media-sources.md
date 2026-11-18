# Editorial media sources

Stock footage sources verified: 2026-11-18 (JST session date).

The first two entries are licensed stock footage used as editorial imagery for the REYZ website. They are not REYZ client work, affiliated creators, employees, testimonials, or endorsements. Their visible media captions must say `イメージ映像` or equivalent. Do not describe the people as REYZ members or infer their individual identities or nationalities. Original brand graphics are documented separately below.

## Stock footage license

- Primary license: https://www.pexels.com/license/
- Pexels explicitly permits free use on websites and in promotion, and permits modification. Attribution is optional.
- The license prohibits implying endorsement by depicted people or brands, offensive portrayals of identifiable people, resale of unaltered copies, redistribution as competing stock, and use as a trademark.
- The actual source pages below displayed the Pexels free license and the named contributor. No purchase, subscription, or additional account agreement was made.
- The videos and stills are hosted in the repository; site visitors do not request them from Pexels.

## 1. Creator film

| Field | Value |
| --- | --- |
| Local video | `site/assets/editorial/creator-film.mp4` |
| Local poster | `site/assets/editorial/creator-film.webp` |
| Source title | Women Wearing Black Outfit |
| Contributor | cottonbro studio |
| Source page | https://www.pexels.com/video/women-wearing-black-outfit-7871211/ |
| Original download | https://videos.pexels.com/video-files/7871211/7871211-hd_1366_720_25fps.mp4 |
| Source publication | 2021-05-12T14:00:47.871Z (source page JSON-LD) |
| Visual | Three women in black clothing, posing in a minimal studio with a circular light on a pale background |
| Transformation | Source seconds 2–10, scaled to 1280 × 674, 24 fps, H.264, muted, fast-start MP4 |
| Poster | First frame of the delivered video, WebP quality 82; no retouching, compositing, or identity changes |
| Video size | 550,396 bytes |
| Poster size | 17,526 bytes |
| Video SHA-256 | `09d037dbb4b99dc891beff2dabc76d0b8914447579e8b02d7ac90568d61a57ff` |
| Poster SHA-256 | `4f956abd5fb0a03590c882d3aea9ba7e1655a1ecab5f8e5c930c2dd59ef4cc66` |

## 2. Production film

| Field | Value |
| --- | --- |
| Local video | `site/assets/editorial/production-film.mp4` |
| Local poster | `site/assets/editorial/production-film.webp` |
| Source title | A camera with a woman on the screen |
| Contributor | cottonbro studio |
| Source page | https://www.pexels.com/video/a-camera-with-a-woman-on-the-screen-4620918/ |
| Original download | https://videos.pexels.com/video-files/4620918/4620918-hd_1366_720_50fps.mp4 |
| Source publication | 2020-07-15T15:00:39.620Z (source page JSON-LD) |
| Visual | Close view of a real camera during a recording, with the interviewed person visible on its screen |
| Transformation | Source seconds 0.5–8.5, scaled to 1280 × 674, 24 fps, H.264, muted, fast-start MP4 |
| Poster | First frame of the delivered video, WebP quality 82; no retouching, compositing, or identity changes |
| Video size | 580,675 bytes |
| Poster size | 30,894 bytes |
| Video SHA-256 | `23e3b609c35828b964d3c4fdfdedeaec104293ad128504da8f93beedb88f88cb` |
| Poster SHA-256 | `e27f0dcf33853a2e5e667981853b1cb1d5d1e8cc3e13b6b4d31ec3c806e62b8e` |

## Delivery checks for stock footage

- Both MP4 files contain one H.264 video stream, 1280 × 674, 24 fps, 8.000 seconds, and no audio stream.
- Posters were visually inspected and match the first frames of their videos.
- Total delivered media: 1,179,491 bytes (approximately 1.18 MB).
- Playback should use `muted playsinline loop` and a visible play/pause control. Prefer poster-first / lazy source loading, and do not autoplay when reduced motion is requested.
- Source files are documentary stock-camera footage published in 2020 and 2021. They were not generated with an AI image or video model for this project.

## Original 3D brand loop

Created: 2026-11-18 UTC.

| Field | Value |
| --- | --- |
| Local video | `site/assets/brand/infinity-motion.mp4` |
| Local poster | `site/assets/brand/infinity-motion.webp` |
| Scene source | `tools/render_brand.py` |
| Reproduction helper | `tools/render_brand_motion.sh` |
| Geometry and materials | Procedural continuous infinity ribbon, separate dark machined edge, satin pink metal based on `#F715AC`, black floor, white and pink area lighting |
| Motion | A periodic five-second sequence of ribbon rotation and vertical movement, camera movement, and rim-light intensity changes |
| Rendering | Blender 4.3.2, EEVEE Next, 16 render samples per frame, 120 independently rendered native frames |
| Delivered video | 1280 × 720, 24 fps, 5.000 seconds, H.264 High, yuv420p, BT.709 color matrix, no audio, fast-start MP4 |
| Poster | Encoded first video frame, WebP quality 90; same composition and color conversion as the video |
| Video size | 441,582 bytes |
| Poster size | 30,206 bytes |
| Video SHA-256 | `c19abb3ba39a51c1e2fdf2df1c139f2ac24f0c0fb902c9c270f4856da91c0871` |
| Poster SHA-256 | `51cdd3b22e2204ddac91819667ca522de37e1f0aa3bb1ddefdc400b2d7c6ee82` |

This is an original procedural brand animation made from the repository's existing infinity scene. It uses no external 3D model, texture, stock footage, or generated human likeness. The established `infinity-ribbon.webp` still is preserved. Motion comes from the actual 3D scene; no still-image pan, synthesized in-between frames, or optical-flow interpolation is used. Its purpose is to give the established REYZ infinity mark a continuous, dimensional presence in the homepage hero.

To reproduce it, install Blender 4.3.2, FFmpeg with libx264/libwebp, Python 3, and Pillow, then run from the repository root:

```sh
bash tools/render_brand_motion.sh /tmp/reyz-brand-motion
```

The helper renders sequentially to limit memory use. Interrupted renders can resume with `render_brand.py --start N --end M` while retaining `--frames 120 --width 1280 --samples 16`, then encode the completed sequence with:

```sh
bash tools/render_brand_motion.sh /tmp/reyz-brand-motion --encode-only
```

Delivery verification:

- All 120 PNG sources passed image-integrity and 1280 × 720 dimension checks.
- FFmpeg decoded the complete delivered video without errors; ffprobe counted exactly 120 video frames and no audio stream.
- The MP4 `moov` atom precedes `mdat`, so playback does not require downloading the whole file first.
- Native frames 0, 30, 60, and 90, and the final poster, were visually inspected for clean edges, material detail, composition, and cropping.
- The native sequence's mean absolute 8-bit channel change at the loop join (119 → 0) was 0.7797, within the range of ordinary adjacent frames (0.6526–1.0342). All three resumed-render boundaries were also within that range.
- The delivered video is approximately 0.44 MB, below the 2 MB delivery budget. Temporary outputs are fully decoded before replacing the final video and poster.

## Original social-sharing brand cover

| Field | Value |
| --- | --- |
| Local image | `site/assets/og-editorial.png` |
| Input reference | Existing public REYZ cover, `site/assets/og-image.png` |
| Creation | Imagegen edit using the existing cover as the image reference; exported with FFmpeg to exactly 1200 × 630, RGB PNG |
| Prompt | `tools/prompts/og-editorial.txt` |
| Visual | REYZ typography and a continuous pink sculptural infinity ribbon on a black studio background |
| Use | Website Open Graph / social-sharing image only |
| Dimensions | 1200 × 630 |
| File size | 858,142 bytes |
| SHA-256 | `66883f7eda0eec880e89cbc4ef5b8932cb41ca468a426b9ec6bfb0f4aecf48e6` |

This is a generated brand illustration derived from the established public cover. It does not depict a client project, a person, product performance, an award, or a real photograph. The prompt explicitly excludes invented award marks, statistics, and people. It is separate from the procedurally rendered 3D website loop.

