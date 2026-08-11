/** DOM-independent extraction of closed-door geometry from PDF.js operators. */

export interface Point2D {
  readonly x: number
  readonly y: number
}

/** One source PDF cubic, transformed into unrotated page coordinates. */
export interface DoorCubicSegment {
  readonly start: Point2D
  readonly control1: Point2D
  readonly control2: Point2D
  readonly end: Point2D
}

/** The subset of `pdfjs.OPS` needed by the extractor. */
export interface DoorOperatorCodes {
  readonly save: number
  readonly restore: number
  readonly transform: number
  readonly constructPath: number
  readonly beginMarkedContent: number
  readonly beginMarkedContentProps: number
  readonly endMarkedContent: number
  readonly paintFormXObjectBegin: number
  readonly paintFormXObjectEnd: number
  readonly beginGroup: number
  readonly endGroup: number
  readonly stroke: number
  readonly closeStroke: number
  readonly fillStroke: number
  readonly eoFillStroke: number
  readonly closeFillStroke: number
  readonly closeEOFillStroke: number
}

/** The shape returned by `PDFPageProxy.getOperatorList`. */
export interface PdfOperatorListLike {
  readonly fnArray: readonly number[]
  readonly argsArray: readonly unknown[]
}

/** PDF.js 6.2.x path-buffer codes. They are not exported by its public bundle. */
export interface DoorDrawPathCodes {
  readonly moveTo: number
  readonly lineTo: number
  readonly curveTo: number
  readonly quadraticCurveTo: number
  readonly closePath: number
}

export const PDFJS_DRAW_PATH_CODES = Object.freeze({
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} satisfies DoorDrawPathCodes)

export interface DoorClosure {
  /** Fixed hinge point in unrotated PDF page coordinates. */
  readonly hinge: Point2D
  /** End of the leaf when drawn across the doorway. */
  readonly closedEnd: Point2D
  /** End of the leaf in the source drawing's open position. */
  readonly openEnd: Point2D
  readonly radius: number
  readonly sweepDegrees: number
  readonly arcOperatorIndex: number
  readonly leafOperatorIndex: number
  readonly optionalContentOccurrence: number
  /** Exact optional-content group ID that owns both matched source paths. */
  readonly sourceLayerId: string
  /** Original swing path in page coordinates, suitable for exact overpainting. */
  readonly sourceArcCubics: readonly DoorCubicSegment[]
  /** Original open leaf polyline in page coordinates. */
  readonly sourceLeafVertices: readonly Point2D[]
  /** Lower is a closer geometric match. */
  readonly matchScore: number
}

export interface DoorGeometryDiagnostics {
  readonly optionalContentOccurrences: number
  readonly pathOperators: number
  readonly unreadablePathOperators: number
  readonly curvedSubpaths: number
  readonly linearSubpaths: number
  readonly duplicateLinearSubpaths: number
  readonly circularArcCandidates: number
  readonly duplicateArcCandidates: number
  readonly matchedSwingCandidates: number
  readonly duplicateClosures: number
  readonly rejectedFullCircles: number
  readonly rejectedNonCircular: number
  readonly rejectedSweep: number
  readonly rejectedWithoutLeaf: number
}

export interface DoorGeometryResult {
  /** Unique closed barriers for occupancy-map drawing and user-facing counts. */
  readonly closures: readonly DoorClosure[]
  /** Every matched source symbol before barrier deduplication, for erasure. */
  readonly sourceMatches: readonly DoorClosure[]
  readonly diagnostics: DoorGeometryDiagnostics
}

export interface DoorGeometryOptions {
  /** Exact optional-content group IDs whose normalized layer suffix is ADO. */
  readonly adoLayerIds: ReadonlySet<string> | readonly string[]
  readonly operatorCodes: DoorOperatorCodes
  readonly drawPathCodes?: DoorDrawPathCodes
}

type Matrix = readonly [number, number, number, number, number, number]

interface DecodedSubpath {
  readonly operatorIndex: number
  readonly occurrence: number
  readonly layerId: string
  readonly vertices: readonly Point2D[]
  readonly cubics: readonly DoorCubicSegment[]
  readonly lineCount: number
  readonly hasQuadratic: boolean
}

interface ArcCandidate {
  readonly subpath: DecodedSubpath
  readonly center: Point2D
  readonly start: Point2D
  readonly end: Point2D
  readonly radius: number
  readonly sweepRadians: number
}

interface LeafMatchCandidate {
  readonly arcIndex: number
  readonly leafIndex: number
  readonly openAtStart: boolean
  readonly score: number
  readonly sourceLeafVertices: readonly Point2D[]
}

interface LeafMatchScore {
  readonly score: number
  readonly sourceLeafVertices: readonly Point2D[]
}

interface MutableDiagnostics {
  optionalContentOccurrences: number
  pathOperators: number
  unreadablePathOperators: number
  curvedSubpaths: number
  linearSubpaths: number
  duplicateLinearSubpaths: number
  circularArcCandidates: number
  duplicateArcCandidates: number
  matchedSwingCandidates: number
  duplicateClosures: number
  rejectedFullCircles: number
  rejectedNonCircular: number
  rejectedSweep: number
  rejectedWithoutLeaf: number
}

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0]
const MIN_SWEEP_RADIANS = (15 * Math.PI) / 180
const MAX_SWEEP_RADIANS = (200 * Math.PI) / 180
const MAX_TANGENT_RADIAL_COSINE = Math.sin((8 * Math.PI) / 180)
const GEOMETRY_CLUSTER_TOLERANCE = 0.8
const CLOSURE_DEDUPLICATION_TOLERANCE = 0.8
const CLOSED_LOOP_VERTEX_TOLERANCE = 0.05

interface ActiveAdoMarker {
  readonly occurrence: number
  readonly layerId: string
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function asUnknownArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null
}

function asNumberArray(value: unknown): ArrayLike<number> | null {
  const candidate = value as { readonly length?: unknown } | null
  if (
    typeof value !== 'object' ||
    value === null ||
    !('length' in value) ||
    !Number.isSafeInteger(candidate?.length) ||
    (candidate?.length as number) < 0
  ) {
    return null
  }
  return value as ArrayLike<number>
}

function asMatrix(value: unknown): Matrix | null {
  const values = asNumberArray(value)
  if (!values || values.length !== 6) return null
  const matrix = Array.from(values)
  if (!matrix.every(isFiniteNumber)) return null
  return matrix as unknown as Matrix
}

function multiplyMatrices(first: Matrix, second: Matrix): Matrix {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ]
}

function transformPoint(matrix: Matrix, x: number, y: number): Point2D {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  }
}

function subtract(first: Point2D, second: Point2D): Point2D {
  return { x: first.x - second.x, y: first.y - second.y }
}

function dot(first: Point2D, second: Point2D): number {
  return first.x * second.x + first.y * second.y
}

function cross(first: Point2D, second: Point2D): number {
  return first.x * second.y - first.y * second.x
}

function magnitude(vector: Point2D): number {
  return Math.hypot(vector.x, vector.y)
}

function distance(first: Point2D, second: Point2D): number {
  return magnitude(subtract(first, second))
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? Number.NaN
  return ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2
}

function intersectEndpointNormals(segment: DoorCubicSegment): Point2D | null {
  const startTangent = subtract(segment.control1, segment.start)
  const endTangent = subtract(segment.end, segment.control2)
  if (magnitude(startTangent) < 1e-9 || magnitude(endTangent) < 1e-9) {
    return null
  }

  const startNormal = { x: -startTangent.y, y: startTangent.x }
  const endNormal = { x: -endTangent.y, y: endTangent.x }
  const denominator = cross(startNormal, endNormal)
  const scale = magnitude(startNormal) * magnitude(endNormal)
  if (Math.abs(denominator) <= scale * 1e-8) return null

  const betweenEndpoints = subtract(segment.end, segment.start)
  const amount = cross(betweenEndpoints, endNormal) / denominator
  return {
    x: segment.start.x + amount * startNormal.x,
    y: segment.start.y + amount * startNormal.y,
  }
}

function cubicPoint(segment: DoorCubicSegment, amount: number): Point2D {
  const inverse = 1 - amount
  const startWeight = inverse * inverse * inverse
  const control1Weight = 3 * inverse * inverse * amount
  const control2Weight = 3 * inverse * amount * amount
  const endWeight = amount * amount * amount
  return {
    x:
      startWeight * segment.start.x +
      control1Weight * segment.control1.x +
      control2Weight * segment.control2.x +
      endWeight * segment.end.x,
    y:
      startWeight * segment.start.y +
      control1Weight * segment.control1.y +
      control2Weight * segment.control2.y +
      endWeight * segment.end.y,
  }
}

function normalizedSweep(
  center: Point2D,
  segment: DoorCubicSegment,
): number | null {
  const startRadius = subtract(segment.start, center)
  const endRadius = subtract(segment.end, center)
  const tangent = subtract(segment.control1, segment.start)
  const orientation = Math.sign(cross(startRadius, tangent))
  if (orientation === 0) return null

  let angle = Math.atan2(cross(startRadius, endRadius), dot(startRadius, endRadius))
  if (orientation > 0 && angle <= 0) angle += 2 * Math.PI
  if (orientation < 0 && angle >= 0) angle -= 2 * Math.PI
  return angle
}

type ArcFit =
  | { readonly status: 'candidate'; readonly arc: ArcCandidate }
  | { readonly status: 'full-circle' | 'non-circular' | 'sweep' }

function fitCircularArc(subpath: DecodedSubpath): ArcFit {
  if (
    subpath.cubics.length === 0 ||
    subpath.lineCount > 0 ||
    subpath.hasQuadratic
  ) {
    return { status: 'non-circular' }
  }

  const centerSamples = subpath.cubics
    .map(intersectEndpointNormals)
    .filter((point): point is Point2D => point !== null)
  if (centerSamples.length !== subpath.cubics.length) {
    return { status: 'non-circular' }
  }

  const center = {
    x: median(centerSamples.map((point) => point.x)),
    y: median(centerSamples.map((point) => point.y)),
  }
  const radialSamples = subpath.cubics.flatMap((segment) => [
    segment.start,
    cubicPoint(segment, 0.5),
    segment.end,
  ])
  const radii = radialSamples.map((point) => distance(point, center))
  const radius = median(radii)
  if (!Number.isFinite(radius) || radius <= 0) {
    return { status: 'non-circular' }
  }

  const radialTolerance = Math.max(0.35, radius * 0.05)
  if (radii.some((value) => Math.abs(value - radius) > radialTolerance)) {
    return { status: 'non-circular' }
  }

  for (const segment of subpath.cubics) {
    const tangentPairs = [
      [subtract(segment.control1, segment.start), subtract(segment.start, center)],
      [subtract(segment.end, segment.control2), subtract(segment.end, center)],
    ] as const
    for (const [tangent, radial] of tangentPairs) {
      const denominator = magnitude(tangent) * magnitude(radial)
      if (
        denominator <= 1e-9 ||
        Math.abs(dot(tangent, radial)) / denominator > MAX_TANGENT_RADIAL_COSINE
      ) {
        return { status: 'non-circular' }
      }
    }
  }

  const start = subpath.cubics[0]?.start
  const end = subpath.cubics.at(-1)?.end
  if (!start || !end) return { status: 'non-circular' }
  if (distance(start, end) <= Math.max(0.25, radius * 0.03)) {
    return { status: 'full-circle' }
  }

  const sweeps: number[] = []
  for (const segment of subpath.cubics) {
    const sweep = normalizedSweep(center, segment)
    if (sweep === null) return { status: 'non-circular' }
    sweeps.push(sweep)
  }
  const firstDirection = Math.sign(sweeps[0] ?? 0)
  if (
    firstDirection === 0 ||
    sweeps.some((value) => Math.sign(value) !== firstDirection)
  ) {
    return { status: 'non-circular' }
  }
  const sweepRadians = sweeps.reduce(
    (total, value) => total + Math.abs(value),
    0,
  )
  if (
    sweepRadians < MIN_SWEEP_RADIANS ||
    sweepRadians > MAX_SWEEP_RADIANS
  ) {
    return { status: 'sweep' }
  }

  return {
    status: 'candidate',
    arc: { subpath, center, start, end, radius, sweepRadians },
  }
}

function makeSubpath(
  operatorIndex: number,
  occurrence: number,
  layerId: string,
  vertices: readonly Point2D[],
  cubics: readonly DoorCubicSegment[],
  lineCount: number,
  hasQuadratic: boolean,
): DecodedSubpath | null {
  if (vertices.length === 0) return null
  return {
    operatorIndex,
    occurrence,
    layerId,
    vertices: [...vertices],
    cubics: [...cubics],
    lineCount,
    hasQuadratic,
  }
}

function decodeSubpaths(
  buffer: ArrayLike<number>,
  matrix: Matrix,
  operatorIndex: number,
  occurrence: number,
  layerId: string,
  drawCodes: DoorDrawPathCodes,
): readonly DecodedSubpath[] | null {
  const result: DecodedSubpath[] = []
  let vertices: Point2D[] = []
  let cubics: DoorCubicSegment[] = []
  let lineCount = 0
  let hasQuadratic = false
  let current: Point2D | null = null
  let start: Point2D | null = null

  const finish = (): void => {
    const subpath = makeSubpath(
      operatorIndex,
      occurrence,
      layerId,
      vertices,
      cubics,
      lineCount,
      hasQuadratic,
    )
    if (subpath) result.push(subpath)
    vertices = []
    cubics = []
    lineCount = 0
    hasQuadratic = false
    current = null
    start = null
  }

  const readCoordinate = (index: number): number | null => {
    const value = buffer[index]
    return isFiniteNumber(value) ? value : null
  }
  const readPoint = (index: number): Point2D | null => {
    const x = readCoordinate(index)
    const y = readCoordinate(index + 1)
    return x === null || y === null ? null : transformPoint(matrix, x, y)
  }

  for (let index = 0; index < buffer.length;) {
    const command = readCoordinate(index)
    index += 1
    if (command === null) return null

    if (command === drawCodes.moveTo) {
      if (vertices.length > 0) finish()
      const point = readPoint(index)
      if (!point) return null
      index += 2
      current = point
      start = point
      vertices.push(point)
      continue
    }
    if (command === drawCodes.lineTo) {
      const point = readPoint(index)
      if (!current || !point) return null
      index += 2
      current = point
      vertices.push(point)
      lineCount += 1
      continue
    }
    if (command === drawCodes.curveTo) {
      const control1 = readPoint(index)
      const control2 = readPoint(index + 2)
      const end = readPoint(index + 4)
      if (!current || !control1 || !control2 || !end) return null
      index += 6
      cubics.push({ start: current, control1, control2, end })
      current = end
      vertices.push(end)
      continue
    }
    if (command === drawCodes.quadraticCurveTo) {
      const control = readPoint(index)
      const end = readPoint(index + 2)
      if (!current || !control || !end) return null
      index += 4
      current = end
      vertices.push(end)
      hasQuadratic = true
      continue
    }
    if (command === drawCodes.closePath) {
      if (!current || !start) return null
      if (distance(current, start) > 1e-9) {
        vertices.push(start)
        lineCount += 1
      }
      current = start
      continue
    }
    return null
  }
  finish()
  return result
}

function visibleAdoMarker(
  stack: readonly (ActiveAdoMarker | null)[],
): ActiveAdoMarker | null {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const marker = stack[index]
    if (marker !== null && marker !== undefined) return marker
  }
  return null
}

function directAdoLayerId(
  value: unknown,
  adoLayerIds: ReadonlySet<string>,
): string | null {
  if (typeof value !== 'object' || value === null) return null
  const marker = value as { readonly type?: unknown; readonly id?: unknown }
  return marker.type === 'OCG' &&
    typeof marker.id === 'string' &&
    adoLayerIds.has(marker.id)
    ? marker.id
    : null
}

function isStrokePaintOperation(value: unknown, codes: DoorOperatorCodes): boolean {
  if (!isFiniteNumber(value)) return false
  return new Set([
    codes.stroke,
    codes.closeStroke,
    codes.fillStroke,
    codes.eoFillStroke,
    codes.closeFillStroke,
    codes.closeEOFillStroke,
  ]).has(value)
}

function decodeConstructPathBuffer(args: readonly unknown[]): ArrayLike<number> | null {
  const data = asUnknownArray(args[1])
  return data ? asNumberArray(data[0]) : null
}

function repeatedVertexLoopSlices(
  vertices: readonly Point2D[],
): readonly (readonly Point2D[])[] {
  const slices: Point2D[][] = []
  for (let start = 0; start < vertices.length - 3; start += 1) {
    const startPoint = vertices[start]
    if (!startPoint) continue
    for (let end = start + 3; end < vertices.length; end += 1) {
      const endPoint = vertices[end]
      if (
        !endPoint ||
        distance(startPoint, endPoint) > CLOSED_LOOP_VERTEX_TOLERANCE ||
        (start === 0 && end === vertices.length - 1)
      ) {
        continue
      }
      slices.push(vertices.slice(start, end + 1))
    }
  }
  return slices
}

function scoreLeafVertices(
  vertices: readonly Point2D[],
  leaf: DecodedSubpath,
  arc: ArcCandidate,
  endpoint: Point2D,
): number | null {
  const radial = subtract(endpoint, arc.center)
  const radius = magnitude(radial)
  if (radius <= 1e-9) return null
  const direction = { x: radial.x / radius, y: radial.y / radius }

  let minimumProjection = Number.POSITIVE_INFINITY
  let maximumProjection = Number.NEGATIVE_INFINITY
  let maximumPerpendicularDistance = 0
  let hingeDistance = Number.POSITIVE_INFINITY
  let tipDistance = Number.POSITIVE_INFINITY
  for (const vertex of vertices) {
    const fromHinge = subtract(vertex, arc.center)
    const projection = dot(fromHinge, direction)
    minimumProjection = Math.min(minimumProjection, projection)
    maximumProjection = Math.max(maximumProjection, projection)
    maximumPerpendicularDistance = Math.max(
      maximumPerpendicularDistance,
      Math.abs(cross(fromHinge, direction)),
    )
    hingeDistance = Math.min(hingeDistance, magnitude(fromHinge))
    tipDistance = Math.min(tipDistance, distance(vertex, endpoint))
  }

  const span = maximumProjection - minimumProjection
  const endpointTolerance = Math.max(0.5, radius * 0.12)
  const perpendicularTolerance = Math.max(0.5, radius * 0.1)
  if (
    span < radius * 0.8 ||
    span > radius * 1.2 ||
    minimumProjection < -radius * 0.2 ||
    maximumProjection > radius * 1.2 ||
    hingeDistance > endpointTolerance ||
    tipDistance > endpointTolerance ||
    maximumPerpendicularDistance > perpendicularTolerance
  ) {
    return null
  }

  const operatorDistance = Math.abs(
    leaf.operatorIndex - arc.subpath.operatorIndex,
  )
  const occurrencePenalty =
    leaf.occurrence === arc.subpath.occurrence ? 0 : 0.0001
  return (
    hingeDistance / endpointTolerance +
    tipDistance / endpointTolerance +
    maximumPerpendicularDistance / perpendicularTolerance +
    Math.abs(span / radius - 1) * 2 +
    occurrencePenalty +
    Math.min(operatorDistance, 10_000) * 1e-6
  )
}

function leafMatchScore(
  leaf: DecodedSubpath,
  arc: ArcCandidate,
  endpoint: Point2D,
): LeafMatchScore | null {
  if (
    leaf.layerId !== arc.subpath.layerId ||
    leaf.cubics.length > 0 ||
    leaf.hasQuadratic ||
    leaf.lineCount === 0
  ) {
    return null
  }

  let best: LeafMatchScore | null = null
  const vertexCandidates = [
    leaf.vertices,
    ...repeatedVertexLoopSlices(leaf.vertices),
  ]
  for (const vertices of vertexCandidates) {
    const score = scoreLeafVertices(vertices, leaf, arc, endpoint)
    if (score !== null && (best === null || score < best.score)) {
      best = { score, sourceLeafVertices: vertices }
    }
  }
  return best
}

function equivalentArc(first: ArcCandidate, second: ArcCandidate): boolean {
  if (
    first.subpath.layerId !== second.subpath.layerId ||
    distance(first.center, second.center) > GEOMETRY_CLUSTER_TOLERANCE ||
    Math.abs(first.radius - second.radius) > GEOMETRY_CLUSTER_TOLERANCE
  ) {
    return false
  }
  return (
    (distance(first.start, second.start) <= GEOMETRY_CLUSTER_TOLERANCE &&
      distance(first.end, second.end) <= GEOMETRY_CLUSTER_TOLERANCE) ||
    (distance(first.start, second.end) <= GEOMETRY_CLUSTER_TOLERANCE &&
      distance(first.end, second.start) <= GEOMETRY_CLUSTER_TOLERANCE)
  )
}

function directedVertexDistance(
  first: readonly Point2D[],
  second: readonly Point2D[],
): number {
  let maximum = 0
  for (const point of first) {
    let nearest = Number.POSITIVE_INFINITY
    for (const candidate of second) {
      nearest = Math.min(nearest, distance(point, candidate))
    }
    maximum = Math.max(maximum, nearest)
  }
  return maximum
}

function equivalentLeaf(
  first: DecodedSubpath,
  second: DecodedSubpath,
): boolean {
  if (first.layerId !== second.layerId) return false
  return (
    directedVertexDistance(first.vertices, second.vertices) <=
      GEOMETRY_CLUSTER_TOLERANCE &&
    directedVertexDistance(second.vertices, first.vertices) <=
      GEOMETRY_CLUSTER_TOLERANCE
  )
}

function clusterGeometry<T>(
  items: readonly T[],
  equivalent: (first: T, second: T) => boolean,
): { readonly retained: T[]; readonly duplicateCount: number } {
  const retained: T[] = []
  let duplicateCount = 0
  for (const item of items) {
    if (retained.some((candidate) => equivalent(candidate, item))) {
      duplicateCount += 1
    } else {
      retained.push(item)
    }
  }
  return { retained, duplicateCount }
}

function matchLeaves(
  arcs: readonly ArcCandidate[],
  leaves: readonly DecodedSubpath[],
): readonly LeafMatchCandidate[] {
  const candidates: LeafMatchCandidate[] = []
  for (let arcIndex = 0; arcIndex < arcs.length; arcIndex += 1) {
    const arc = arcs[arcIndex]
    if (!arc) continue
    for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
      const leaf = leaves[leafIndex]
      if (!leaf || leaf.layerId !== arc.subpath.layerId) continue
      const startScore = leafMatchScore(leaf, arc, arc.start)
      if (startScore !== null) {
        candidates.push({
          arcIndex,
          leafIndex,
          openAtStart: true,
          score: startScore.score,
          sourceLeafVertices: startScore.sourceLeafVertices,
        })
      }
      const endScore = leafMatchScore(leaf, arc, arc.end)
      if (endScore !== null) {
        candidates.push({
          arcIndex,
          leafIndex,
          openAtStart: false,
          score: endScore.score,
          sourceLeafVertices: endScore.sourceLeafVertices,
        })
      }
    }
  }

  candidates.sort((first, second) => first.score - second.score)
  const usedArcs = new Set<number>()
  const usedLeaves = new Set<number>()
  const matches: LeafMatchCandidate[] = []
  for (const candidate of candidates) {
    if (usedArcs.has(candidate.arcIndex) || usedLeaves.has(candidate.leafIndex)) {
      continue
    }
    usedArcs.add(candidate.arcIndex)
    usedLeaves.add(candidate.leafIndex)
    matches.push(candidate)
  }
  return matches
}

function samePoint(first: Point2D, second: Point2D, tolerance: number): boolean {
  return distance(first, second) <= tolerance
}

function sameClosure(first: DoorClosure, second: DoorClosure): boolean {
  const tolerance = CLOSURE_DEDUPLICATION_TOLERANCE
  return (
    (samePoint(first.hinge, second.hinge, tolerance) &&
      samePoint(first.closedEnd, second.closedEnd, tolerance)) ||
    (samePoint(first.hinge, second.closedEnd, tolerance) &&
      samePoint(first.closedEnd, second.hinge, tolerance))
  )
}

function deduplicateClosures(
  closures: readonly DoorClosure[],
): { readonly closures: DoorClosure[]; readonly duplicateCount: number } {
  const retained: DoorClosure[] = []
  let duplicateCount = 0
  for (const closure of [...closures].sort(
    (first, second) => first.matchScore - second.matchScore,
  )) {
    if (retained.some((candidate) => sameClosure(candidate, closure))) {
      duplicateCount += 1
    } else {
      retained.push(closure)
    }
  }
  return { closures: retained, duplicateCount }
}

/**
 * Finds hinged-door swing arcs and returns their leaves in the closed position.
 * Call this before rendering: PDF.js replaces decoded path buffers with Path2D
 * objects during canvas rendering.
 */
export function extractDoorGeometry(
  operatorList: PdfOperatorListLike,
  options: DoorGeometryOptions,
): DoorGeometryResult {
  if (operatorList.fnArray.length !== operatorList.argsArray.length) {
    throw new Error('PDF operator and argument arrays must have equal lengths.')
  }

  const { operatorCodes: codes } = options
  const drawCodes = options.drawPathCodes ?? PDFJS_DRAW_PATH_CODES
  const adoLayerIds = new Set(options.adoLayerIds)
  const paintCodes = codes
  const diagnostics: MutableDiagnostics = {
    optionalContentOccurrences: 0,
    pathOperators: 0,
    unreadablePathOperators: 0,
    curvedSubpaths: 0,
    linearSubpaths: 0,
    duplicateLinearSubpaths: 0,
    circularArcCandidates: 0,
    duplicateArcCandidates: 0,
    matchedSwingCandidates: 0,
    duplicateClosures: 0,
    rejectedFullCircles: 0,
    rejectedNonCircular: 0,
    rejectedSweep: 0,
    rejectedWithoutLeaf: 0,
  }

  let matrix: Matrix = IDENTITY_MATRIX
  const matrixStack: Matrix[] = []
  const markedContentStack: (ActiveAdoMarker | null)[] = []
  let nextOccurrence = 0
  const pathOperatorIndices = new Set<number>()
  const subpaths: DecodedSubpath[] = []

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operation = operatorList.fnArray[index]
    const args = asUnknownArray(operatorList.argsArray[index])

    if (operation === codes.beginMarkedContentProps) {
      const layerId =
        args?.[0] === 'OC' ? directAdoLayerId(args[1], adoLayerIds) : null
      if (layerId !== null) {
        const occurrence = nextOccurrence
        nextOccurrence += 1
        diagnostics.optionalContentOccurrences += 1
        markedContentStack.push({ occurrence, layerId })
      } else {
        markedContentStack.push(null)
      }
      continue
    }
    if (operation === codes.beginMarkedContent) {
      markedContentStack.push(null)
      continue
    }
    if (operation === codes.endMarkedContent) {
      markedContentStack.pop()
      continue
    }

    if (operation === codes.save || operation === codes.beginGroup) {
      matrixStack.push(matrix)
      continue
    }
    if (operation === codes.restore || operation === codes.endGroup) {
      matrix = matrixStack.pop() ?? matrix
      continue
    }
    if (operation === codes.paintFormXObjectBegin) {
      matrixStack.push(matrix)
      const formMatrix = asMatrix(args?.[0])
      if (formMatrix) matrix = multiplyMatrices(matrix, formMatrix)
      continue
    }
    if (operation === codes.paintFormXObjectEnd) {
      matrix = matrixStack.pop() ?? matrix
      continue
    }
    if (operation === codes.transform) {
      const transform = asMatrix(args)
      if (transform) matrix = multiplyMatrices(matrix, transform)
      continue
    }

    const marker = visibleAdoMarker(markedContentStack)
    if (operation !== codes.constructPath || marker === null) continue
    if (!args || !isStrokePaintOperation(args[0], paintCodes)) continue
    pathOperatorIndices.add(index)
    const buffer = decodeConstructPathBuffer(args)
    if (!buffer) {
      diagnostics.unreadablePathOperators += 1
      continue
    }
    const decoded = decodeSubpaths(
      buffer,
      matrix,
      index,
      marker.occurrence,
      marker.layerId,
      drawCodes,
    )
    if (!decoded) {
      diagnostics.unreadablePathOperators += 1
      continue
    }
    subpaths.push(...decoded)
  }

  diagnostics.pathOperators = pathOperatorIndices.size
  const rawLeaves = subpaths.filter(
    (subpath) =>
      subpath.lineCount > 0 &&
      subpath.cubics.length === 0 &&
      !subpath.hasQuadratic,
  )
  diagnostics.linearSubpaths = rawLeaves.length
  const clusteredLeaves = clusterGeometry(rawLeaves, equivalentLeaf)
  const leaves = clusteredLeaves.retained
  diagnostics.duplicateLinearSubpaths = clusteredLeaves.duplicateCount

  const rawArcs: ArcCandidate[] = []
  for (const subpath of subpaths) {
    if (subpath.cubics.length === 0 && !subpath.hasQuadratic) continue
    diagnostics.curvedSubpaths += 1
    const fit = fitCircularArc(subpath)
    if (fit.status === 'candidate') {
      rawArcs.push(fit.arc)
      diagnostics.circularArcCandidates += 1
    } else if (fit.status === 'full-circle') {
      diagnostics.rejectedFullCircles += 1
    } else if (fit.status === 'sweep') {
      diagnostics.rejectedSweep += 1
    } else {
      diagnostics.rejectedNonCircular += 1
    }
  }

  const clusteredArcs = clusterGeometry(rawArcs, equivalentArc)
  const arcs = clusteredArcs.retained
  diagnostics.duplicateArcCandidates = clusteredArcs.duplicateCount
  const matches = matchLeaves(arcs, leaves)
  diagnostics.matchedSwingCandidates = matches.length
  diagnostics.rejectedWithoutLeaf = arcs.length - matches.length
  const matchedClosures = matches.flatMap((match): DoorClosure[] => {
    const arc = arcs[match.arcIndex]
    const leaf = leaves[match.leafIndex]
    if (!arc || !leaf) return []
    return [{
      hinge: arc.center,
      closedEnd: match.openAtStart ? arc.end : arc.start,
      openEnd: match.openAtStart ? arc.start : arc.end,
      radius: arc.radius,
      sweepDegrees: (arc.sweepRadians * 180) / Math.PI,
      arcOperatorIndex: arc.subpath.operatorIndex,
      leafOperatorIndex: leaf.operatorIndex,
      optionalContentOccurrence: arc.subpath.occurrence,
      sourceLayerId: arc.subpath.layerId,
      sourceArcCubics: arc.subpath.cubics,
      sourceLeafVertices: match.sourceLeafVertices,
      matchScore: match.score,
    }]
  })
  const deduplicated = deduplicateClosures(matchedClosures)
  diagnostics.duplicateClosures = deduplicated.duplicateCount

  return {
    closures: deduplicated.closures,
    sourceMatches: matchedClosures,
    diagnostics,
  }
}
