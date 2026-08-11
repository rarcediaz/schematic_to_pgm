import { describe, expect, it } from 'vitest'

import {
  extractDoorGeometry,
  PDFJS_DRAW_PATH_CODES,
  type DoorOperatorCodes,
  type PdfOperatorListLike,
  type Point2D,
} from './door-geometry'

const OPS = Object.freeze({
  save: 1,
  restore: 2,
  transform: 3,
  constructPath: 4,
  beginMarkedContent: 5,
  beginMarkedContentProps: 6,
  endMarkedContent: 7,
  paintFormXObjectBegin: 8,
  paintFormXObjectEnd: 9,
  beginGroup: 10,
  endGroup: 11,
  stroke: 20,
  closeStroke: 21,
  fillStroke: 22,
  eoFillStroke: 23,
  closeFillStroke: 24,
  closeEOFillStroke: 25,
} satisfies DoorOperatorCodes)

const ADO_ID = 'ado-id'

class OperatorListBuilder {
  readonly fnArray: number[] = []
  readonly argsArray: unknown[] = []

  add(operation: number, args: unknown = null): this {
    this.fnArray.push(operation)
    this.argsArray.push(args)
    return this
  }

  beginLayer(id = ADO_ID): this {
    return this.add(OPS.beginMarkedContentProps, [
      'OC',
      { type: 'OCG', id },
    ])
  }

  endLayer(): this {
    return this.add(OPS.endMarkedContent)
  }

  stroke(buffer: Float32Array): this {
    return this.add(OPS.constructPath, [OPS.stroke, [buffer], null])
  }

  build(): PdfOperatorListLike {
    return { fnArray: this.fnArray, argsArray: this.argsArray }
  }
}

function pointOnCircle(radius: number, radians: number): Point2D {
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) }
}

function circularArc(
  radius: number,
  startDegrees: number,
  endDegrees: number,
): Float32Array {
  const start = (startDegrees * Math.PI) / 180
  const end = (endDegrees * Math.PI) / 180
  const segmentCount = Math.max(1, Math.ceil(Math.abs(end - start) / (Math.PI / 2)))
  const segmentSweep = (end - start) / segmentCount
  const buffer: number[] = [
    PDFJS_DRAW_PATH_CODES.moveTo,
    ...Object.values(pointOnCircle(radius, start)),
  ]

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const angle0 = start + segmentSweep * segment
    const angle1 = angle0 + segmentSweep
    const startPoint = pointOnCircle(radius, angle0)
    const endPoint = pointOnCircle(radius, angle1)
    const tangent0 = { x: -Math.sin(angle0), y: Math.cos(angle0) }
    const tangent1 = { x: -Math.sin(angle1), y: Math.cos(angle1) }
    const amount = (4 / 3) * Math.tan(segmentSweep / 4) * radius
    buffer.push(
      PDFJS_DRAW_PATH_CODES.curveTo,
      startPoint.x + amount * tangent0.x,
      startPoint.y + amount * tangent0.y,
      endPoint.x - amount * tangent1.x,
      endPoint.y - amount * tangent1.y,
      endPoint.x,
      endPoint.y,
    )
  }
  return new Float32Array(buffer)
}

function radialLine(endpoint: Point2D): Float32Array {
  return new Float32Array([
    PDFJS_DRAW_PATH_CODES.moveTo,
    0,
    0,
    PDFJS_DRAW_PATH_CODES.lineTo,
    endpoint.x,
    endpoint.y,
  ])
}

function skinnyRadialRectangle(endpoint: Point2D, width = 0.4): Float32Array {
  const length = Math.hypot(endpoint.x, endpoint.y)
  const perpendicular = {
    x: (-endpoint.y / length) * (width / 2),
    y: (endpoint.x / length) * (width / 2),
  }
  return new Float32Array([
    PDFJS_DRAW_PATH_CODES.moveTo,
    perpendicular.x,
    perpendicular.y,
    PDFJS_DRAW_PATH_CODES.lineTo,
    endpoint.x + perpendicular.x,
    endpoint.y + perpendicular.y,
    PDFJS_DRAW_PATH_CODES.lineTo,
    endpoint.x - perpendicular.x,
    endpoint.y - perpendicular.y,
    PDFJS_DRAW_PATH_CODES.lineTo,
    -perpendicular.x,
    -perpendicular.y,
    PDFJS_DRAW_PATH_CODES.closePath,
  ])
}

function radialRectangleWithAttachedContinuation(
  endpoint: Point2D,
  width = 0.4,
): Float32Array {
  const length = Math.hypot(endpoint.x, endpoint.y)
  const perpendicular = {
    x: (-endpoint.y / length) * (width / 2),
    y: (endpoint.x / length) * (width / 2),
  }
  return new Float32Array([
    PDFJS_DRAW_PATH_CODES.moveTo,
    perpendicular.x,
    perpendicular.y,
    PDFJS_DRAW_PATH_CODES.lineTo,
    endpoint.x + perpendicular.x,
    endpoint.y + perpendicular.y,
    PDFJS_DRAW_PATH_CODES.lineTo,
    endpoint.x - perpendicular.x,
    endpoint.y - perpendicular.y,
    PDFJS_DRAW_PATH_CODES.lineTo,
    -perpendicular.x,
    -perpendicular.y,
    PDFJS_DRAW_PATH_CODES.lineTo,
    perpendicular.x,
    perpendicular.y,
    PDFJS_DRAW_PATH_CODES.lineTo,
    perpendicular.x * 20,
    perpendicular.y * 20,
  ])
}

function extract(operatorList: PdfOperatorListLike) {
  return extractDoorGeometry(operatorList, {
    adoLayerIds: new Set([ADO_ID]),
    operatorCodes: OPS,
  })
}

function expectPointClose(actual: Point2D, expected: Point2D): void {
  expect(actual.x).toBeCloseTo(expected.x, 4)
  expect(actual.y).toBeCloseTo(expected.y, 4)
}

describe('PDF door geometry extraction', () => {
  it('uses the source CTM and returns the opposite radial as the closure', () => {
    const list = new OperatorListBuilder()
      .add(OPS.transform, [2, 0, 0, 2, 5, 7])
      .beginLayer()
      .stroke(circularArc(10, 0, 90))
      .stroke(radialLine(pointOnCircle(10, 0)))
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toHaveLength(1)
    const closure = result.closures[0]
    expect(closure).toBeDefined()
    expectPointClose(closure!.hinge, { x: 5, y: 7 })
    expectPointClose(closure!.openEnd, { x: 25, y: 7 })
    expectPointClose(closure!.closedEnd, { x: 5, y: 27 })
    expect(closure!.radius).toBeCloseTo(20, 4)
    expect(closure!.sweepDegrees).toBeCloseTo(90, 3)
    expect(closure!.sourceLayerId).toBe(ADO_ID)
    expect(closure!.sourceArcCubics).toHaveLength(1)
    const sourceCubic = closure!.sourceArcCubics[0]
    expect(sourceCubic).toBeDefined()
    expectPointClose(sourceCubic!.start, { x: 25, y: 7 })
    expectPointClose(sourceCubic!.control1, { x: 25, y: 18.0457 })
    expectPointClose(sourceCubic!.control2, { x: 16.0457, y: 27 })
    expectPointClose(sourceCubic!.end, { x: 5, y: 27 })
    expect(closure!.sourceLeafVertices).toHaveLength(2)
    expectPointClose(closure!.sourceLeafVertices[0]!, { x: 5, y: 7 })
    expectPointClose(closure!.sourceLeafVertices[1]!, { x: 25, y: 7 })
    expect(result.diagnostics).toMatchObject({
      optionalContentOccurrences: 1,
      circularArcCandidates: 1,
      matchedSwingCandidates: 1,
      rejectedWithoutLeaf: 0,
    })
  })

  it('treats a multi-cubic 180-degree swing as one complete subpath', () => {
    const radius = 12
    const list = new OperatorListBuilder()
      .beginLayer()
      .stroke(skinnyRadialRectangle(pointOnCircle(radius, Math.PI / 2)))
      .stroke(circularArc(radius, -90, 90))
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toHaveLength(1)
    expectPointClose(result.closures[0]!.openEnd, { x: 0, y: radius })
    expectPointClose(result.closures[0]!.closedEnd, { x: 0, y: -radius })
    expect(result.closures[0]!.sweepDegrees).toBeCloseTo(180, 3)
    expect(result.closures[0]!.sourceArcCubics).toHaveLength(2)
    expectPointClose(
      result.closures[0]!.sourceArcCubics[0]!.end,
      result.closures[0]!.sourceArcCubics[1]!.start,
    )
  })

  it('accepts a partial swing when a full-radius leaf identifies its open end', () => {
    const radius = 16
    const openEnd = pointOnCircle(radius, (24 * Math.PI) / 180)
    const list = new OperatorListBuilder()
      .beginLayer()
      .stroke(circularArc(radius, 0, 24))
      .stroke(skinnyRadialRectangle(openEnd))
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toHaveLength(1)
    expectPointClose(result.closures[0]!.openEnd, openEnd)
    expectPointClose(result.closures[0]!.closedEnd, { x: radius, y: 0 })
    expect(result.closures[0]!.sweepDegrees).toBeCloseTo(24, 3)
  })

  it('matches a repeated-vertex leaf loop without erasing its attached continuation', () => {
    const radius = 10
    const openEnd = { x: radius, y: 0 }
    const list = new OperatorListBuilder()
      .beginLayer()
      .stroke(circularArc(radius, 0, 90))
      .stroke(radialRectangleWithAttachedContinuation(openEnd))
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toHaveLength(1)
    const closure = result.closures[0]!
    expectPointClose(closure.openEnd, openEnd)
    expectPointClose(closure.closedEnd, { x: 0, y: radius })
    expect(closure.sourceLeafVertices).toHaveLength(5)
    expectPointClose(
      closure.sourceLeafVertices[0]!,
      closure.sourceLeafVertices.at(-1)!,
    )
    expect(closure.sourceLeafVertices).not.toContainEqual({ x: 0, y: 4 })
  })

  it('pairs geometry split across occurrences of the same exact ADO ID', () => {
    const list = new OperatorListBuilder()
      .beginLayer()
      .stroke(circularArc(10, 0, 90))
      .endLayer()
      .beginLayer()
      .stroke(radialLine({ x: 10, y: 0 }))
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toHaveLength(1)
    expect(result.diagnostics).toMatchObject({
      optionalContentOccurrences: 2,
      circularArcCandidates: 1,
      matchedSwingCandidates: 1,
      rejectedWithoutLeaf: 0,
    })
  })

  it('ignores other optional-content IDs even when their geometry matches', () => {
    const list = new OperatorListBuilder()
      .beginLayer('not-ado')
      .stroke(circularArc(10, 0, 90))
      .stroke(radialLine({ x: 10, y: 0 }))
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toEqual([])
    expect(result.diagnostics.optionalContentOccurrences).toBe(0)
    expect(result.diagnostics.pathOperators).toBe(0)
  })

  it('rejects full circles and unpaired circular artifacts conservatively', () => {
    const list = new OperatorListBuilder()
      .beginLayer()
      .stroke(circularArc(8, 0, 360))
      .stroke(circularArc(10, 0, 90))
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toEqual([])
    expect(result.diagnostics).toMatchObject({
      curvedSubpaths: 2,
      circularArcCandidates: 1,
      rejectedFullCircles: 1,
      rejectedWithoutLeaf: 1,
    })
  })

  it('clusters repeated arcs and leaves before greedy assignment', () => {
    const firstDoor = new OperatorListBuilder()
      .beginLayer()
      .stroke(circularArc(10, 0, 90))
      .stroke(radialLine({ x: 10, y: 0 }))
      .endLayer()
    const list = firstDoor
      .beginLayer()
      .stroke(circularArc(10, 0, 90))
      .stroke(radialLine({ x: 10, y: 0 }))
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toHaveLength(1)
    expect(result.sourceMatches).toHaveLength(1)
    expect(result.diagnostics).toMatchObject({
      matchedSwingCandidates: 1,
      duplicateArcCandidates: 1,
      duplicateLinearSubpaths: 1,
      duplicateClosures: 0,
    })
  })

  it('retains opposite source swings that deduplicate to one closed barrier', () => {
    const radius = 10
    const list = new OperatorListBuilder()
      .beginLayer()
      .stroke(circularArc(radius, 0, 90))
      .stroke(radialLine({ x: 0, y: radius }))
      .stroke(circularArc(radius, 0, -90))
      .stroke(radialLine({ x: 0, y: -radius }))
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.sourceMatches).toHaveLength(2)
    expect(result.closures).toHaveLength(1)
    expect(result.diagnostics).toMatchObject({
      matchedSwingCandidates: 2,
      duplicateClosures: 1,
    })
    for (const sourceMatch of result.sourceMatches) {
      expectPointClose(sourceMatch.hinge, { x: 0, y: 0 })
      expectPointClose(sourceMatch.closedEnd, { x: radius, y: 0 })
    }
  })

  it('keeps two double-door halves that share a closed endpoint', () => {
    const list = new OperatorListBuilder()
      .beginLayer()
      .add(OPS.save)
      .add(OPS.transform, [1, 0, 0, 1, -10, 0])
      .stroke(circularArc(10, 90, 0))
      .stroke(radialLine({ x: 0, y: 10 }))
      .add(OPS.restore)
      .add(OPS.save)
      .add(OPS.transform, [1, 0, 0, 1, 10, 0])
      .stroke(circularArc(10, 90, 180))
      .stroke(radialLine({ x: 0, y: 10 }))
      .add(OPS.restore)
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toHaveLength(2)
    for (const closure of result.closures) {
      expectPointClose(closure.closedEnd, { x: 0, y: 0 })
    }
    expect(result.diagnostics.duplicateArcCandidates).toBe(0)
    expect(result.diagnostics.duplicateClosures).toBe(0)
  })

  it('applies nested form transforms and restores the previous CTM', () => {
    const list = new OperatorListBuilder()
      .add(OPS.transform, [1, 0, 0, 1, 3, 4])
      .beginLayer()
      .add(OPS.paintFormXObjectBegin, [[0, 1, -1, 0, 20, 30], null])
      .stroke(circularArc(10, 0, 90))
      .stroke(radialLine({ x: 10, y: 0 }))
      .add(OPS.paintFormXObjectEnd)
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toHaveLength(1)
    expectPointClose(result.closures[0]!.hinge, { x: 23, y: 34 })
    expectPointClose(result.closures[0]!.openEnd, { x: 23, y: 44 })
    expectPointClose(result.closures[0]!.closedEnd, { x: 13, y: 34 })
  })

  it('reports an operator list whose path buffer has already become opaque', () => {
    const list = new OperatorListBuilder()
      .beginLayer()
      .add(OPS.constructPath, [OPS.stroke, [{}], null])
      .endLayer()
      .build()

    const result = extract(list)

    expect(result.closures).toEqual([])
    expect(result.diagnostics.unreadablePathOperators).toBe(1)
  })

  it('rejects mismatched operator and argument arrays', () => {
    expect(() =>
      extract({ fnArray: [OPS.save], argsArray: [] }),
    ).toThrow(/equal lengths/)
  })
})
