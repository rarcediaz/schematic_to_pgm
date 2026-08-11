/** Product limits and ROS map defaults for the SFU PDF pipeline. */
export const PDF_POINTS_PER_INCH = 72
export const PDF_INSPECTION_DPI = 36
export const MAX_PDF_BYTES = 20 * 1024 * 1024
export const MAX_OUTPUT_PIXELS = 25_000_000
export const MAX_OUTPUT_DIMENSION = 16_384

export const MAP_DEFAULTS = Object.freeze({
  baseFilename: 'map',
  resolution: 0.05,
  originX: 0,
  originY: 0,
  originYaw: 0,
  mode: 'trinary',
  negate: 0,
  occupiedThreshold: 0.65,
  freeThreshold: 0.25,
} as const)

/** Exact image bytes used by the trinary preview and exported PGM. */
export const OCCUPANCY_PALETTE = Object.freeze({
  occupied: 0,
  /** Visually distinct; its darkness (255 - 80) / 255 exceeds the threshold. */
  excluded: 80,
  free: 255,
} as const)

export const PGM_MIME_TYPE = 'image/x-portable-graymap'
export const YAML_MIME_TYPE = 'text/yaml;charset=utf-8'
