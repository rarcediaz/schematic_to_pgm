# ROS Map Generator

ROS Map Generator is a deliberately small browser application for turning a single-page SFU building schematic PDF into a grayscale PGM image and a companion ROS map YAML file.

The staged SFU cleanup and calibration work is tracked in
[ROADMAP.md](ROADMAP.md).

## MVP scope

The first version renders the complete PDF sheet exactly as shown at a fixed **150 DPI**. Every visible part of the page is preserved, including drawing borders, grid lines, labels, door swings, title blocks, and exterior whitespace.

- Input: one single-page SFU schematic PDF
- Output: a grayscale PGM file and matching YAML metadata
- Processing: entirely in the browser; the PDF is not uploaded to a server
- Cleanup: no cropping, layer filtering, thresholding, or removal of drawing marks
- Scale: no automatic drawing-scale or real-world distance interpretation

This is a conversion prototype, not yet a navigation-ready map generator. Later versions can add SFU-specific cleanup after the basic rendering and export pipeline is proven.

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

## Important YAML scale caveat

The PDF rendering DPI and the ROS YAML `resolution` describe different things:

- **150 DPI** controls how many output pixels are created from the physical PDF page.
- YAML **`resolution`** is the real-world number of metres represented by one output pixel.

The application does not infer the schematic's printed scale or verify that it was printed at its intended physical size. A resolution entered in the YAML is metadata only; it does not resize or calibrate the drawing. Before using the result for ROS navigation, determine the resolution from a trustworthy known distance in the schematic and validate it against the generated image.

## Cross-platform checks

GitHub Actions runs the tests and production build on both Ubuntu and Windows for every push and pull request. Text files use consistent line endings through `.gitattributes` and `.editorconfig`, and dependency versions are reproduced through npm's committed lockfile.
