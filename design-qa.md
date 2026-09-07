# Spatial Feed design QA

final result: passed

## Source and scope

- Source reference: https://jp.pinterest.com/pin/961448220464782789/
- Original image: https://i.pinimg.com/736x/3d/92/90/3d92905a996b9baceabfeb4e1c76d877.jpg (600×945)
- Adopted visual asset: `public/images/feed/topic-atrium-v1.webp` (1024×1024)
- Implementation initial: `/Users/liuzx/personal-content-os/reports/spatial-release-2026-09-07/topics-desktop-initial.png`
- Stable desktop capture: `/Users/liuzx/personal-content-os/reports/spatial-release-2026-09-07/topics-desktop-stable.png`
- Initial mobile: `/Users/liuzx/personal-content-os/reports/spatial-release-2026-09-07/topics-mobile-initial.png`
- Homepage: `/Users/liuzx/personal-content-os/reports/spatial-release-2026-09-07/home-initial.png`
- Viewports: desktop 1440×1000, mobile 390×844, device scale factor 1.

## Comparison boundary

This is an authorized adaptation of an architectural poster into a reading product, not a pixel clone. The original contains no application typography, buttons or data. Spatial material, room separation and restrained illumination are compared against the visual source; UI hierarchy and behavior are assessed against the agreed brief. Artwork uses its original square aspect ratio without stretching. Source asset and desktop implementation were opened together in one comparison call.

## First pass

- Typography: desktop list headlines remain 20–22px; the topic reading pane uses 18px article headings and 14px summaries. No poster-sized Chinese titles.
- Layout: original architectural asset is contained within the left exploration region; articles occupy a separate opaque right pane. Mobile uses a contained illustration followed by buttons.
- Colors: dark ink, pearl lavender and ice blue; removed persistent scan strips and broad page grids to give visual priority to the architecture.
- Image quality: six complete glass rooms, no fake CSS-room illustration, no image-baked UI labels. A 68KB WebP supplies both homepage and topic-space views.
- Copy: real API topic names/counts, explicit published-content state and a statement that spatial distance does not encode inferred relationships.

## Findings and fix history

1. [P2, resolved] Mobile selected-topic results appeared below the first viewport. Added focus and scroll to the reading panel after selection, respecting reduced motion.
2. [P2, resolved] Fixed effects control overlapped the lower mobile topic buttons. Moved the control into normal page flow below 900px; `topics-mobile-final.png` confirms unobstructed buttons.
3. [P2, resolved] Missing artwork left positioned buttons in a large empty stage. Added a static grid fallback; `image-fallback.png` plus computed `position: static` confirm the fallback. Controls remain usable.
4. [P2, resolved] The first mobile scroll began before loading settled and ended at 480.5px. Deferred positioning until the selected topic reaches ready/error. Post-fix test confirms panel top 19.5px; `mobile-reading.png` shows the selected AI 工程 articles.

## Final comparison and acceptance

- Final desktop: `/Users/liuzx/personal-content-os/reports/spatial-release-2026-09-07/topics-desktop-final.png` (1440×1000).
- Final mobile: `/Users/liuzx/personal-content-os/reports/spatial-release-2026-09-07/topics-mobile-final.png` (390×844).
- Focused mobile reading: `/Users/liuzx/personal-content-os/reports/spatial-release-2026-09-07/mobile-reading.png` (390×844).
- Final source asset, desktop screenshot and focused mobile reading screenshot were inspected in the same comparison call. The artwork preserves the square aspect ratio, six distinct rooms and a readable non-raster label layer; no actionable P0/P1/P2 visual mismatch remains against the adaptation brief.
- Topic selection matches the requested topic and expected article identity `/feed/486669c1710026fe`; URL, group bounds, list/search and empty search checked.
- Simulated image failure, article HTTP 503 followed by retry recovery, and metadata HTTP 503 feedback checked.
- Pointer parallax and effects-off behavior checked; OS reduced-motion disables the control and cancels spatial movement.
- 320, 390, 768 and 1440px viewports show no horizontal overflow. Browser page-error list was empty in normal interactions; resource errors were intentionally injected only for failure-state tests.
- 185 tests passed, including reader privacy/publication contract tests and new topic parsing/URL-boundary tests. Cloudflare Pages build passed. Scoped frontend lint and security scan found no new issues.

Production deployment and unauthenticated live checks are recorded separately in the release receipt. This report does not claim an original-reference pixel clone or a complete WCAG audit.

## Follow-up polish

- P3: the poster-like scene continues slightly below the first 1000px desktop viewport; normal vertical scrolling exposes the footer/group controls. No control is clipped by the layout.
