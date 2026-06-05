import { useState } from 'react'
export type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'select'
export const PALETTE = ['#eaeefb', '#ffd34e', '#ff6f6f', '#5ad19a', '#8aa0ff', '#ffb86b']

export function useTool() {
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(PALETTE[0])
  const [size, setSize] = useState(4)
  return { tool, setTool, color, setColor, size, setSize }
}
