import type {Move} from './viewport'
import type {ReactFlowInstance} from '@xyflow/react'

import {describe, expectTypeOf, it} from 'vitest'

/** The keys of React Flow's instance that cannot move the viewport. */
type CannotMove =
  | 'viewportInitialized'
  | 'getNodes'
  | 'setNodes'
  | 'addNodes'
  | 'getNode'
  | 'getInternalNode'
  | 'getEdges'
  | 'setEdges'
  | 'addEdges'
  | 'getEdge'
  | 'toObject'
  | 'deleteElements'
  | 'getIntersectingNodes'
  | 'isNodeIntersecting'
  | 'updateNode'
  | 'updateNodeData'
  | 'updateEdge'
  | 'updateEdgeData'
  | 'getNodesBounds'
  | 'getHandleConnections'
  | 'getNodeConnections'
  | 'getZoom'
  | 'getViewport'
  | 'screenToFlowPosition'
  | 'flowToScreenPosition'

describe('useViewport', () => {
  it('counts every move React Flow’s instance has, so a React Flow upgrade that adds a key fails the typecheck until it is sorted', () => {
    expectTypeOf<keyof ReactFlowInstance>().toEqualTypeOf<Move | CannotMove>()
  })
})
