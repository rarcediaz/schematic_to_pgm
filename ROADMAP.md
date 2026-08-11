# ROS Map Generator roadmap

Last updated: 2026-08-10

This document tracks the path from the current calibrated SFU cleanup pipeline
to a navigation-ready ROS map generator. The work remains deliberately
incremental: every milestone must preserve a usable raw-conversion fallback.

## Product scope

- Accept authorized, single-page SFU Burnaby key-plan PDFs from the
  [SFU Key Plans site](https://www.sfu.ca/fs/campus-maps/key-plans/burnaby-campus.html).
- Process the PDF locally in the browser; do not upload floor plans to a server.
- Detect the printed drawing scale separately for every sheet.
- Support every scale represented by the approved SFU sample corpus, including
  both `1:250` and `1:400`; `1:400` is a required format, not a fallback case.
- Remove SFU grid, text, and selected symbol layers without damaging structural
  walls or turning unsafe space into free space.
- Show the user the proposed cleanup and occupancy map before export.
- Export a calibrated binary PGM and matching ROS YAML that can be validated in
  ROS 2/Nav2.

Out of scope for the first SFU pipeline: arbitrary architectural drawings,
scanned PDFs, multi-page documents, AI-based reconstruction, a backend, user
accounts, and automatic downloading from the ID-protected SFU site.

Source PDFs should not be committed to a public repository unless SFU has
explicitly permitted redistribution. Tests can use private local fixtures,
small synthetic PDFs, and approved derived test regions.

## What the current version already does

- [x] Opens one single-page PDF in the browser.
- [x] Validates file type, size, page count, password protection, and render size.
- [x] Detects `1:250` and `1:400` title-block scales from vector PDF text.
- [x] Derives render DPI from detected scale and requested ROS resolution.
- [x] Inventories and normalizes AutoCAD optional-content layers.
- [x] Removes verified grid, room-text, title, border, and north-indicator layers.
- [x] Detects structural plan bounds at inspection resolution and renders a
      calibrated crop with a one-metre margin.
- [x] Replaces confident `ADO` and vetted glazing/detail swing-door pairs with
      closed barriers. If no `ADO` pair is confident, that layer is retained
      and warned.
- [x] Preserves unknown and stair layers for later processing.
- [x] Shows the exact trinary hallway occupancy preview used for export.
- [x] Exports an exact binary P5 PGM and companion ROS YAML.
- [x] Runs without a backend and keeps the source PDF on the user's computer.
- [x] Has unit tests, a production build, and Windows/Ubuntu CI configuration.

The current PGM and YAML agree on physical pixel resolution and trinary palette,
but the output is not yet navigation-ready because stairs and special symbols
still need semantic handling and ROS/Nav2 golden-map validation remains
unfinished.

## Evidence from the initial SFU sample set

| Sheet | Building | Printed scale | PDF layers | Notes |
| --- | ---: | ---: | ---: | --- |
| Applied Science Building 9000 | 038 | `1:250` | 21 | Initial sample |
| Blusson Hall 9000 | 017 | `1:250` | 18 | Same sheet template and core layer family |
| Academic Quadrangle 3000 | 002 | `1:400` | 24 | Confirms that scale and optional layers vary |

All three observed files are single-page, pure-vector AutoCAD 2023 exports with
the same 29 by 17.5 inch sheet size, a 270-degree page rotation, a common title
block, and a common optional-content-layer family. Useful recurring layer suffixes
include:

- `SGR`, `SGRID`, `SGRDI`: grid graphics and dimensions
- `RM$TXT`: room text
- `ADO`: doors
- `AFLST`: stairs
- `AWA`: walls
- `ASHTT`: sheet/title content
- `BBY-SFU-NORTH`: north indicator

Some layer names have a building/floor prefix and some optional layers appear
only in certain files. The implementation must therefore compare the suffix
after `|`, preserve unknown layers by default, and show a warning rather than
silently deleting unfamiliar content. SFU says its key plans are updated
regularly, so the profile and regression corpus will be versioned rather than
treated as permanently fixed.

## Target processing flow

```text
Validate PDF
  -> inspect title text, scale, page geometry, and layers
  -> automatically accept a unique supported scale
  -> render separate semantic layer masks
  -> remove grids and non-map text
  -> close recognized swing doors and handle stairs, arrows, border, and exterior
  -> classify physical barriers / free hallways / excluded space
  -> show the final map and optional cleanup details
  -> request input only for ambiguous or unsupported sheets
  -> export calibrated PGM + YAML
```

## Milestone 0 — Preserve baseline diagnostics

Status: **in progress**

Keep a raw full-sheet diagnostic render available while the SFU pipeline is
developed. It is a useful reference for checking whether cleanup removed
unintended content; it must not be presented as navigation-ready output.

Acceptance gate:

- The unit tests and production build continue to pass.
- An optional raw preview remains available for cleanup diagnostics.

## Milestone 1 — SFU inspector and support profile

Status: **in progress**

- [x] Refactor PDF handling into separate inspect, mask, crop-plan, and render stages.
- [x] Read page size, rotation, title-block text, and optional layers.
- [x] Normalize layer names by their suffix after `|`.
- [x] Add a versioned SFU layer-role registry: keep, grid, text, door, stair,
      annotation, title, and unknown.
- [ ] Add an inspector panel or downloadable diagnostic report. No content is
      removed in this milestone.
- [ ] Build a representative private sample manifest covering several buildings,
      floors, scales, and export dates. Start with the three sheets above and aim
      for 6–10 before declaring the profile stable.

Acceptance gate:

- All three initial samples are identified as supported SFU sheets.
- Their scale candidates and layer inventories are reported correctly.
- Unknown or missing core layers produce a visible warning.
- No unknown layer is automatically removed.

## Milestone 2 — Scale-aware rendering and calibration

Status: **in progress**

- [x] Extract strict `1:n` scale text before hiding title or dimension layers.
- [ ] Show the detected value, source, and confidence, with a manual override.
- [ ] Treat `1:250` as one unit on paper representing 250 units in the building;
      never display or interpret it as `250:1`.
- [x] Derive render DPI from both scale and requested ROS resolution:

      `DPI = scale denominator × 0.0254 / metres per pixel`

- [x] Rerender whenever the requested ROS resolution changes; YAML resolution
      must not remain metadata-only.
- [ ] Cross-check calibration against labeled dimensions or grid spacing where
      available. For example, a labeled 6 m span should be 120 pixels at
      `0.05 m/pixel`.
- [x] Raise the output limit from 20 million to at least 25 million pixels so a
      full `1:400` SFU sheet works at `0.05 m/pixel`, then measure peak memory with
      the Academic Quadrangle sample on supported Windows and Linux browsers.
      Release intermediate canvases promptly. Add cropping, tiling, or packed
      masks only if those measurements show they are necessary. A coarser
      resolution may remain an optional user choice, but cannot be required just
      because the sheet is `1:400`.

At `0.05 m/pixel`, `1:250` requires 127 DPI. The Academic Quadrangle `1:400`
sheet requires 203.2 DPI and produces roughly 20.96 million full-sheet pixels,
slightly above the current limit.

Acceptance gate:

- All three samples detect the correct printed scale.
- Both `1:250` and `1:400` sheets render successfully at `0.05 m/pixel` on the
  supported browser and hardware baseline.
- Image dimensions and YAML resolution describe the same physical map extent.
- Calibration passes the 6 m / 120 px check within two pixels when that reference
  is available.
- Truly ambiguous or unsupported sheets stop with a useful, non-destructive
  choice; a known `1:400` SFU sheet is not considered unsupported.

## Milestone 3 — Layer-first grid and text cleanup

Status: **in progress**

- [x] Capture scale facts before cleanup.
- [x] Render structural and unlayered baseline groups independently.
- [x] Remove `SGR`, `SGRID`, and `SGRDI` through PDF layer visibility first.
- [ ] Remove room labels, dimensions, and standard numbers/letters through known
      text layers such as `RM$TXT` and PDF text geometry.
- [ ] Add conservative visual fallbacks only for content that is not separated
      into layers: repeated light long lines for grids, then glyph geometry/OCR
      for text.
- [x] Remove thin pale overlay traces inside selected hallway space only when
      non-structural pixels have verified free space on opposite sides. Do not
      alter component selection, walls, or excluded rooms.
- [ ] Show grid and text masks as separate, toggleable overlays.

The implementation will rerender selected PDF layers rather than paint white
rectangles over a composite image. This preserves walls that pass beneath a
label or grid intersection. Brightness by itself is not enough to identify a
grid line; the fallback must also consider length, direction, repetition, and
structural overlap.

Acceptance gate:

- Targeted grids and labels disappear in annotated test regions.
- No new structural wall gap larger than one pixel is introduced.
- Low-confidence detections remain visible and are highlighted for review.

## Milestone 4 — SFU symbol and sheet cleanup

Status: **in progress**

- [x] Doors: match confident vector arc-and-leaf pairs on `ADO`, erase only each
      matched source path, and draw its leaf as a straight closed barrier across
      the opening. Unmatched marks stay visible and are reported for review.
- [x] Handle verified doors authored on `AGL` and `AFLWD` without hiding those
      mixed-use layers: replace only each matched source arc/open leaf from a
      layer-hidden background render, enforce a physical door-width gate, then
      draw its closed barrier.
- [x] Report the number of generated closures and unmatched `ADO` curves so the
      processed preview can be checked for missed or unusual symbols.
- [ ] Add conservative fallbacks for unusual non-hinged and special door types.
      Unmatched marks currently remain visible and explicitly counted in
      diagnostics.
- [ ] Stairs: remove tread/arrow clutter, but never turn the stair footprint into
      free navigable space. Classify it as occupied or unknown after a product
      decision.
- [x] Direction arrows and the north indicator: remove from the map image.
- [x] Title block and verified sheet borders: exclude after their
      useful metadata has been read.
- [ ] Add a rule and test cases for elevators, fixtures, furniture, and other
      inaccessible areas before automatically classifying them.
- [ ] Use geometry or image detection only when the relevant SFU layer is absent
      or mixed with content that must be kept.

Acceptance gate:

- Every confidently matched swing door has one closed barrier across its wall
  opening, with no swing arc left in the output.
- An `ADO` layer with no confident closure remains unchanged and produces a
  warning; closure and unmatched-curve counts remain available for review.
- Stair regions never become free space.
- Every removed symbol category has its own preview toggle and undo path.

## Milestone 5 — Plan bounds and trinary occupancy review

Status: **in progress**

- [x] Detect the floor-plan region automatically from structural layer masks.
- [ ] Provide manual crop/polygon correction for low-confidence cases.
- [x] Treat page margins and space outside the building as excluded by default;
      a white PDF page must not become navigable free space.
- [x] Classify hallway-adjacent barriers as occupied, high-confidence main
      circulation as free, and rooms, exterior, or uncertain regions as excluded.
      Use closed-door incidence for the standard plan shape and a separately
      gated courtyard-annulus mode for AQ-style plans.
- [x] Use an explicit three-value preview and PGM palette compatible with YAML
      thresholds. Dark gray 80 remains visually distinct from black walls while
      loading as occupied with the current `occupied_thresh: 0.65`.
- [ ] Add synchronized source, cleaned, and occupancy views with zoom/pan,
      before/after comparison, mask toggles, warnings, and physical dimensions.
- [x] Withhold automatic free-space classification when no supported pattern
      passes its confidence gates; report the reason without forcing supported
      high-confidence sheets through an intermediate confirmation wizard.

Acceptance gate:

- The exported PGM contains only the selected wall/excluded/free values.
- Annotated walls, rooms, and exterior regions have the expected class.
- Changing resolution invalidates prior output and reprocesses the sheet.

## Milestone 6 — ROS validation, hardening, and release

Status: **planned**

- [ ] Load every golden map through the target ROS 2/Nav2 map server.
- [ ] Verify scale, orientation, image/YAML filenames, thresholds, origin, and yaw.
- [ ] Add browser end-to-end and visual regression tests with sensible rendering
      tolerances.
- [ ] Test supported Chrome versions on Windows and Linux.
- [ ] Keep PDF.js pinned and monitored for security updates.
- [ ] Add cancellation, progress, memory cleanup, and useful errors for large
      `1:400` or finer-scale sheets.
- [ ] Initialize Git, choose repository visibility, create the GitHub repository,
      push the baseline, and verify Windows/Ubuntu GitHub Actions.
- [ ] Document the supported SFU profile version and unsupported-file behavior.

Acceptance gate:

- Golden PGM/YAML pairs load in the target ROS environment with the expected
  physical dimensions and orientation.
- Tests and production builds pass locally and in Windows/Ubuntu CI.
- A held-out supported SFU PDF completes without silent destructive cleanup.

## Deferred decisions

These choices should be made using the reviewed sample corpus, not guessed during
the first implementation pass:

1. Should stairs be occupied or unknown in the final map?
2. Is `0.05 m/pixel` always the target, or may the user choose a coarser value for
   very large sheets?
3. How should the ROS origin and yaw be selected: fixed convention, automatic
   building bounds, or user placement?
4. Which fixtures, elevators, furniture, and restricted rooms should be treated
   as occupied?
5. Will the GitHub repository be public or private?

## Definition of navigation-ready

A sheet is navigation-ready only when the scale was detected and confirmed, all
cleanup categories were reviewed, structural walls were preserved, doors were
closed or explicitly reviewed, stairs and exterior were assigned safe classes,
PGM and YAML physical extents agree, and the result loads successfully in the
target ROS 2/Nav2 setup.
