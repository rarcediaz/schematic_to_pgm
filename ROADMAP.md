# ROS Map Generator roadmap

Last updated: 2026-08-08

This document tracks the path from the current full-sheet PDF converter to an
SFU-specific, navigation-ready ROS map generator. The work remains deliberately
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
- [x] Renders the complete sheet at a fixed 150 DPI.
- [x] Shows a full-sheet grayscale preview.
- [x] Exports an exact binary P5 PGM and companion ROS YAML.
- [x] Runs without a backend and keeps the source PDF on the user's computer.
- [x] Has unit tests, a production build, and Windows/Ubuntu CI configuration.
- [ ] Has a real Git repository and GitHub remote.

The current YAML resolution is metadata only. It does not yet resize the image
to match the PDF's printed scale, so current output is not navigation-ready.

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
  -> ask the user to confirm detected scale
  -> render separate semantic layer masks
  -> remove grids and non-map text
  -> handle doors, stairs, arrows, border, and exterior
  -> classify occupied / free / unknown space
  -> show source, cleanup masks, and final occupancy preview
  -> require confirmation
  -> export calibrated PGM + YAML
```

## Milestone 0 — Preserve the working baseline

Status: **complete**

Keep the existing fixed-150-DPI, full-sheet converter available while the SFU
pipeline is developed. It is both a useful fallback and a reference for checking
whether cleanup removed unintended content.

Acceptance gate:

- Existing 12 unit tests and the production build continue to pass.
- A new cleanup feature cannot replace or silently alter the raw preview.

## Milestone 1 — SFU inspector and support profile

Status: **next**

- [ ] Refactor PDF handling into separate inspect, render-plan, and render stages.
- [ ] Read page size, rotation, metadata, title-block text, and optional layers.
- [ ] Normalize layer names by their suffix after `|`.
- [ ] Add a versioned SFU layer-role registry: keep, grid, text, door, stair,
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

Status: **planned**

- [ ] Extract strict `1:n` scale text before hiding title or dimension layers.
- [ ] Show the detected value, source, and confidence, with a manual override.
- [ ] Treat `1:250` as one unit on paper representing 250 units in the building;
      never display or interpret it as `250:1`.
- [ ] Derive render DPI from both scale and requested ROS resolution:

      `DPI = scale denominator × 0.0254 / metres per pixel`

- [ ] Rerender whenever the requested ROS resolution changes; YAML resolution
      must not remain metadata-only.
- [ ] Cross-check calibration against labeled dimensions or grid spacing where
      available. For example, a labeled 6 m span should be 120 pixels at
      `0.05 m/pixel`.
- [ ] Raise the output limit from 20 million to at least 25 million pixels so a
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

Status: **planned**

- [ ] Capture all scale and dimension facts before cleanup.
- [ ] Render structural and removable layer groups independently.
- [ ] Remove `SGR`, `SGRID`, and `SGRDI` through PDF layer visibility first.
- [ ] Remove room labels, dimensions, and standard numbers/letters through known
      text layers such as `RM$TXT` and PDF text geometry.
- [ ] Add conservative visual fallbacks only for content that is not separated
      into layers: repeated light long lines for grids, then glyph geometry/OCR
      for text.
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

Status: **planned**

- [ ] Doors: remove swing arcs and door leaves while preserving the actual wall
      opening and its width.
- [ ] Stairs: remove tread/arrow clutter, but never turn the stair footprint into
      free navigable space. Classify it as occupied or unknown after a product
      decision.
- [ ] Direction arrows and the north indicator: remove from the map image.
- [ ] Title block, border, legends, and sheet annotations: exclude after their
      useful metadata has been read.
- [ ] Add a rule and test cases for elevators, fixtures, furniture, and other
      inaccessible areas before automatically classifying them.
- [ ] Use geometry or image detection only when the relevant SFU layer is absent
      or mixed with content that must be kept.

Acceptance gate:

- Door openings remain within one pixel of their pre-cleanup width.
- Stair regions never become free space.
- Every removed symbol category has its own preview toggle and undo path.

## Milestone 5 — Plan bounds and trinary occupancy review

Status: **planned**

- [ ] Detect the floor-plan region and provide manual crop/polygon correction.
- [ ] Treat page margins and space outside the building as unknown by default;
      a white PDF page must not become navigable free space.
- [ ] Classify walls as occupied, traversable interior as free, and uncertain or
      excluded regions as unknown.
- [ ] Use an explicit three-value preview and PGM palette compatible with YAML
      thresholds. Mid-gray 127 is a safe initial unknown value; gray 205 would be
      classified as free with the current `free_thresh: 0.25`.
- [ ] Add synchronized source, cleaned, and occupancy views with zoom/pan,
      before/after comparison, mask toggles, warnings, and physical dimensions.
- [ ] Disable final export until the user confirms the scale and reviewed map.

Acceptance gate:

- The exported PGM contains only the selected occupied/free/unknown values.
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
2. Should exterior space be unknown or occupied? The safer initial default is
   unknown.
3. Is `0.05 m/pixel` always the target, or may the user choose a coarser value for
   very large sheets?
4. How should the ROS origin and yaw be selected: fixed convention, automatic
   building bounds, or user placement?
5. Which fixtures, elevators, furniture, and restricted rooms should be treated
   as occupied?
6. Will the GitHub repository be public or private?

## Definition of navigation-ready

A sheet is navigation-ready only when the scale was detected and confirmed, all
cleanup categories were reviewed, structural walls and door openings were
preserved, stairs and exterior were assigned safe classes, PGM and YAML physical
extents agree, and the result loads successfully in the target ROS 2/Nav2 setup.
