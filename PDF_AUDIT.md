# SFU PDF schematic audit

Audit date: 2026-08-12

## Corpus summary

- 172 PDFs inspected.
- All 172 are valid, single-page vector PDFs with the common SFU
  `1260 × 2088 pt`, 270-degree sheet geometry.
- Every sheet contains one unambiguous printed scale.
- Observed scales: `1:50` (7), `1:75` (1), `1:100` (5), `1:125` (36),
  `1:150` (6), `1:175` (12), `1:200` (21), `1:250` (44), `1:300` (12),
  and `1:400` (28).
- The converter now recognizes the shared SFU template even when optional grid,
  north-arrow, or `AWA` layers are absent. Unknown layers are still retained.

This audit classifies whether a sheet is a sensible source for one indoor
hallway navigation map. It does not certify the output for autonomous use.

## Do not convert as an indoor hallway map

These 21 sheets are roofs, parkades, or small/special-purpose structures with
no useful indoor hallway network:

### Roof plans

- `Applied_Science_Building_Roof_Level.pdf`
- `Courtyard Residence Roof Level.pdf`
- `W_A_C_Bennett_Library_Roof_Level.pdf`

### Parking and parkade plans

- `Cornerstone P1 Level.pdf`
- `Discovery 1 P1 Level.pdf`
- `Discovery 1 P2 Level.pdf`
- `Rsdns Lot 21 P1 Level.pdf`
- `Visitors Parkade 100 Level.pdf`
- `Visitors Parkade 200 Level.pdf`
- `Visitors Parkade 300 Level.pdf`
- `West Mall Centre P1 Level.pdf`
- `West Mall Centre P2 Level.pdf`

### No meaningful hallway network

- `Beedie Field Concession.pdf`
- `Fire Pump Station.pdf`
- `Greenhouse 1.pdf`
- `Greenhouse 2.pdf`
- `Greenhouse 3.pdf`
- `Greenhouse 5.pdf`
- `Service Station.pdf`
- `Transit Loop Building.pdf`
- `Trottier Observatory.pdf`

## Split into separate maps before conversion

These 12 single-page PDFs contain multiple floor-plan drawings. Treating the
whole page as one floor could create disconnected or cross-level free space.
They are potentially useful only after the individual plans are detected and
cropped separately:

- `Bee Research Building.pdf`
- `Child Care Centre Building 1.pdf`
- `Child Care Centre Building 2.pdf`
- `Child Care Centre Building 3.pdf`
- `Child Care Centre Building 4.pdf`
- `Diamond Family Auditorium.pdf`
- `Discovery 2 100 Level.pdf`
- `Discovery_2_200_Level.pdf`
- `Hamilton Hall 1000 & 2000 Level.pdf`
- `Hamilton Hall 3000 & 4000 Level.pdf`
- `Shell House 1000 & 2000 Level.pdf`
- `Townhouse Chilcotin.pdf`

`Discovery 1 P2 Level.pdf` and `W_A_C_Bennett_Library_Roof_Level.pdf` also show
multiple plan regions, but they are already in the do-not-convert categories.

## Manual review recommended

These 14 sheets are not automatic rejects, but their open, sparse, site-heavy,
or direct-access geometry does not fit a normal room-and-hallway plan well:

- `Biology Trailer.pdf`
- `Facilities Services Mezz Level.pdf`
- `The_Water_Tower_Building_100_Level.pdf`
- `The_Water_Tower_Building_300_Level.pdf`
- `The_Water_Tower_Building_400_Level.pdf`
- `Transportation Centre 000 Level.pdf`
- `Transportation Centre 100 Level.pdf`
- `Transportation Centre 200 Level.pdf`
- `Transportation Centre 300 Level.pdf`
- `Convocation_Mall_1000_Level.pdf`
- `Convocation Mall 2000 Level.pdf`
- `Convocation Mall 3000 Level.pdf`
- `Academic Quadrangle 1000 Level.pdf`
- `Academic_Quadrangle_2000_Level.pdf`

The remaining 125 sheets are plausible single-plan hallway-map candidates.
They still require visual review and validation in the target ROS 2/Nav2 setup.

## Safety interpretation of gray rooms

The browser preview keeps excluded room linework visible in light gray. The
exported PGM deliberately keeps those pixels in the occupied class (`80`) under
the generated YAML thresholds. The lighter preview color is presentation only;
it cannot make an excluded room traversable.
