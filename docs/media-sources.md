# Editorial media sources

Stock footage sources verified: 2026-11-18 (JST session date).

The first two entries document licensed stock footage used as editorial imagery for the REYZ website. The Creator film remains current; the old Production film is retained for previously cached pages and is replaced in the current build by the new paper study documented below. They are not REYZ client work, affiliated creators, employees, testimonials, or endorsements. Their visible media captions must say `イメージ映像` or equivalent. Do not describe the people as REYZ members or infer their individual identities or nationalities. Original brand graphics are documented separately below.

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

## 2. Previous production film (retained for cached pages)

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

## 3. Home — Contour

Seven contoured strips form a single infinity sculpture. A standalone C++17 renderer builds the geometry, shades it and renders each frame. The source was written for the 19 November 2026 revision and reads no images, movie frames, meshes or textures. The render and encode commands are at the top of `tools/render_brand_contour.cpp`.

- Film: `site/assets/brand/brand-contour-v1.mp4`; 1280 × 720, 120 frames, 24 fps, 5 seconds, silent H.264 with fast start.
- Poster: `site/assets/brand/brand-contour-v1.webp`, encoded from the first decoded frame.
- SHA-256 (film): `e6336584da088d237d7c749028ba5829bd352fbd15c71b843fcb6fdbd285d2e5`.
- SHA-256 (poster): `dd57a80af8b319fc8178988db7d190c8a7e2a2c74570f09b20c87e6192e05bbd`.
- The previously published paths `infinity-motion.mp4`, `infinity-motion.webp` and `infinity-ribbon.webp` resolve to this film or its matching poster. Pages expands the relative filesystem links when packaging the site for deployment.

## 4. Creative — Paper study

For the same revision, the Blender scene in `tools/render_creative_study.py` builds a pleated paper fan, a graphite curve and a magenta fold from geometry. The movement of the fan, the light and the camera show how a composition changes. Run the rendering command in the source file to generate both delivery assets. The scene has no external media inputs.

- Film: `site/assets/editorial/creative-study-v1.mp4`; 1280 × 674, 96 frames, 24 fps, 4 seconds, silent H.264 with fast start.
- Poster: `site/assets/editorial/creative-study-v1.webp`, encoded from the first decoded frame. The asset-change action in the Creative case study uses this same poster.
- SHA-256 (film): `c3b5f4c074fd421a5142e201f1bc10f4f32151cb4ed18908909522eb90139394`.
- SHA-256 (poster): `749c9ae9a3a94bd2fa20b865422e0dd3de21b687685d66f753bda59d0cbcd150`.
- Visible caption: `構図と光のイメージ映像（CG）`. Credit: `REYZ / Motion study`.
- The HeyGen clip proposed earlier in PR #61 and its still have been removed from the deliverable.

### Case-preview stills (2026-11-20)

The case preview in `/creative#guard` is cropped to a tall frame on wide screens (measured 390 × 573 CSS px; 780 × 1146 device px at 2×), so a 1280 × 674 source was enlarged about 1.7×. Its first version was also the stock Creator poster. Both versions are now stills from this same scene, rendered at twice the film size by `tools/render_creative_study.py -- --stills`.

| Version in the preview | File | Scene frame | Size | Bytes | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| v1, v3, … | `site/assets/editorial/creative-study-still-1.webp` | 1 (fan spread wide) | 2560 × 1348 | 77,934 | `0aa757071fe21646dd76dbe45c8a2edadb92c7014343c8944ea668f51ffe2776` |
| v2, v4, … | `site/assets/editorial/creative-study-still-2.webp` | 49 (fan drawn together) | 2560 × 1348 | 60,530 | `6a254461c0fc16ed0130580df29e68898a8989fdd3363c99b5b0c83b326c36ce` |

- Rendered with the `bpy` module 5.3.0 (EEVEE, software GL). The script selects `BLENDER_EEVEE_NEXT` where it exists and `BLENDER_EEVEE` otherwise; frame 1 at film size was compared by eye with the published poster before rendering.
- The stock Creator film is no longer shown on `/creative`. It remains on `/creator#income` with its caption and credit.

## Social-sharing cover — Contour (current, 2026-11-20)

| Field | Value |
| --- | --- |
| Local image | `site/assets/og-contour-v1.png` |
| Creation | `node tools/render_og_cover.mjs <contour renderer>`: frame 0 of `tools/render_brand_contour.cpp` (the Home poster frame) composed with the site's typefaces in Chromium |
| Typefaces | Inter and Noto Sans JP, weights 400 and 500. The tool stops if either face is not loaded |
| Visual | The seven-strip Contour infinity of the Home film on the site's near-black, REYZ logotype, the fixed headline and `CREATOR ECONOMY × AI` |
| Use | `og:image` on every page |
| Dimensions | 1200 × 630 |
| File size | 326,958 bytes |
| SHA-256 | `c2c9ab9844e949d580e5d5243b04f9376dc26754aca3299f8f629faccc0d749c` |

The previous cover showed a single generated ribbon, a different infinity from the one on the site. This cover uses the site's own sculpture and contains no generated or third-party imagery. For this file the two typefaces were loaded from the `@fontsource/inter` and `@fontsource/noto-sans-jp` packages through the tool's local stylesheet argument, because the rendering environment could not reach Google Fonts.

## Previous social-sharing cover (retained for links already shared)

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

