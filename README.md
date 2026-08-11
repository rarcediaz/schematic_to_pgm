# ROS Map Generator

ROS Map Generator is a browser application for turning a single-page SFU
building schematic PDF into a cleaned, scale-calibrated trinary PGM image and a
companion ROS map YAML file. Main hallways remain white while rooms and page
background become gray and non-traversable.

The staged SFU cleanup and calibration work is tracked in
[ROADMAP.md](ROADMAP.md).

## Current SFU pipeline

When a supported SFU key-plan PDF is selected, the application:

- Input: one single-page SFU schematic PDF
- Output: a trinary hallway-occupancy PGM file and matching YAML metadata
- Processing: entirely in the browser; the PDF is not uploaded to a server
- Scale: detects supported `1:250` and `1:400` title-block scales and derives
  render DPI from the requested ROS resolution
- Cleanup: removes verified grid, room-text, title, sheet-border, and north-arrow
  PDF layers while preserving unknown and stair layers
- Doors: replaces confidently matched arc-and-leaf pairs on the SFU `ADO` and
  vetted glazing/detail layers with straight barriers in the closed-door
  position; doors are not erased into open passages
- Crop: derives building bounds from structural AutoCAD layers and adds a
  one-metre margin before the calibrated final render
- Occupancy: ranks enclosed circulation regions by the number of closed doors
  along their boundary; on AQ-style plans, the verified `GROS` building envelope
  fences off the exterior so the full connected circulation around the courtyard
  can remain free instead of being reduced to a fixed-width ring
- Trace cleanup: absorbs pale drafting overlays up to `0.15 m` wide only when
  verified free hallway exists on opposite sides; walls and excluded rooms are
  never expanded
- Palette: writes only black `0` (wall/barrier), dark gray `80` (excluded and
  occupied), and white `255` (free) pixels to both the preview and PGM

Files that do not match the verified SFU page geometry and core layer profile
are retained only as full-sheet diagnostic previews; map export remains disabled.
A missing, ambiguous, or unsupported scale stops processing rather than silently
creating incorrect YAML metadata.

Door replacement uses a conservative gate. If no confident hinged-door pair is
found, the original `ADO` layer remains visible and processing reports a warning.
For every supported layer, the app replaces only the confidently matched arc
and open leaf with pixels from a render where that source layer is hidden, then
draws the leaf closed. This preserves linework from other layers beneath the
symbol. Unmatched `ADO` marks remain visible and are reported for review rather
than silently turning into open passages.
Unusual non-hinged and special door types may still need a later detector, so
check the processed preview and its diagnostics. Hallway classification also
fails closed: if no supported circulation pattern passes the confidence gates,
the app leaves space excluded and reports why rather than making it white/free.
The trace cleanup is deliberately local and runs only after hallway selection,
so faint overlays cannot change which hallway component was chosen.
The AQ envelope path is also gated: it is used only when one exact, visible
`GROS` layer and the expected dominant courtyard geometry are present. Its
diagnostics report whether the envelope was supplied and accepted, keeping a
missing or ambiguous envelope from silently expanding free space into the page
background.

This is an automatic occupancy-map draft, not yet a robot-validated map.
Exterior and unselected rooms are blocked, but stairs, fixtures, special doors,
and other navigation semantics still need category-specific golden-map tests.

## Prerequisites

- [Node.js](https://nodejs.org/) 22.12 or newer in the Node 22 release line
- npm (included with Node.js)
- Git

The repository's `.node-version` selects Node 22 in version managers that support that file.

## Setup on Windows

Open PowerShell:

```powershell
git clone <repository-url>
Set-Location schematic_to_pgm
npm ci
npm run dev
```

Open the local address printed by Vite in a browser. If a Node version manager is installed, select Node 22 before running `npm ci`.

## Setup on Linux

Open a terminal:

```bash
git clone <repository-url>
cd schematic_to_pgm
npm ci
npm run dev
```

Open the local address printed by Vite in a browser. If a Node version manager is installed, select Node 22 before running `npm ci`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run test` | Run tests in watch mode |
| `npm run test:run` | Run the test suite once |
| `npm run build` | Type-check and create a production build in `dist/` |
| `npm run preview` | Preview the production build locally |

The Vite build uses relative asset paths so the generated `dist/` directory can be hosted at a GitHub Pages project subpath or on another static host.

## Scale and YAML

The detected printed scale and requested YAML `resolution` jointly determine the
PDF render DPI:

```text
DPI = scale denominator × 0.0254 / metres per pixel
```

At the default `0.05 m/pixel`, `1:250` renders at `127 DPI` and `1:400`
renders at `203.2 DPI`. Changing the resolution reruns PDF processing so the PGM
pixels and YAML metadata remain consistent. Before robot use, still validate a
trustworthy known distance and the final map in ROS 2/Nav2.

## Hallway-only occupancy

The preview and PGM use the same exact values:

- `0`: occupied wall or closed-door barrier
- `80`: visually gray but occupied room, courtyard, or page background
- `255`: free main-hallway space

These values are compatible with the emitted `mode: trinary`,
`occupied_thresh: 0.65`, and `free_thresh: 0.25` settings. Both black `0` and
gray `80` load as occupied; only white `255` loads as free. The gray tone keeps
excluded rooms visually distinct from physical walls without relying on a
separate unknown-space planner setting. Validate the resulting map in the target
ROS 2/Nav2 setup before robot use.

## Cross-platform checks

GitHub Actions runs the tests and production build on both Ubuntu and Windows for every push and pull request. Text files use consistent line endings through `.gitattributes` and `.editorconfig`, and dependency versions are reproduced through npm's committed lockfile.
