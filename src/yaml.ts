import { MAP_DEFAULTS, YAML_MIME_TYPE } from './constants'
import {
  validateBaseFilename,
  validateOrigin,
  validateResolution,
} from './validation'

export interface MapYamlOptions {
  baseFilename?: string
  resolution?: string | number
  originX?: string | number
  originY?: string | number
}

function formatNumber(value: number, decimalForInteger = false): string {
  if (Object.is(value, -0)) return decimalForInteger ? '0.0' : '0'
  if (decimalForInteger && Number.isInteger(value)) return value.toFixed(1)
  return String(value)
}

/** Generates the complete ROS 2 map-server YAML using fixed MVP defaults. */
export function createMapYaml(options: MapYamlOptions = {}): string {
  const baseFilename = validateBaseFilename(
    options.baseFilename ?? MAP_DEFAULTS.baseFilename,
  )
  const resolution = validateResolution(
    options.resolution ?? MAP_DEFAULTS.resolution,
  )
  const originX = validateOrigin(options.originX ?? MAP_DEFAULTS.originX, 'X')
  const originY = validateOrigin(options.originY ?? MAP_DEFAULTS.originY, 'Y')

  return [
    `image: ${baseFilename}.pgm`,
    `mode: ${MAP_DEFAULTS.mode}`,
    `resolution: ${formatNumber(resolution)}`,
    `origin: [${formatNumber(originX, true)}, ${formatNumber(originY, true)}, 0.0]`,
    `negate: ${MAP_DEFAULTS.negate}`,
    `occupied_thresh: ${MAP_DEFAULTS.occupiedThreshold}`,
    `free_thresh: ${MAP_DEFAULTS.freeThreshold}`,
    '',
  ].join('\n')
}

export function createMapYamlBlob(options: MapYamlOptions = {}): Blob {
  return new Blob([createMapYaml(options)], { type: YAML_MIME_TYPE })
}
