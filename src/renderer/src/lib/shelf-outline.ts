import { SHELF, SHELF_WINDOW, type ShelfEdge } from '../../../shared/layout'

/**
 * SVG path data for the shelf's notch silhouette: a rounded body whose outer side is the window
 * edge, blended into that edge above and below by concave quarter-circle fillets. Drawn for the
 * right edge and mirrored for the left. `closed` adds the edge segment so the shape can be filled;
 * the open variant is what gets stroked, so no hairline is drawn along the screen edge itself.
 */
export function shelfOutline(edge: ShelfEdge, closed: boolean): string {
  const { width: W, height: H } = SHELF_WINDOW
  const { radius: R, fillet: F, shadow: S } = SHELF
  const x = (v: number): number => (edge === 'right' ? v : W - v)
  // Fillets are drawn clockwise (sweep 1) so the arc's centre lies on the edge: concave. The body
  // corners are drawn anticlockwise (sweep 0), the usual convex rounding. Mirroring flips both.
  const concave = edge === 'right' ? 1 : 0
  const convex = 1 - concave
  const top = F
  const bottom = F + SHELF.body.height
  const d = [
    `M ${x(W)} 0`,
    `A ${F} ${F} 0 0 ${concave} ${x(W - F)} ${top}`,
    `L ${x(S + R)} ${top}`,
    `A ${R} ${R} 0 0 ${convex} ${x(S)} ${top + R}`,
    `L ${x(S)} ${bottom - R}`,
    `A ${R} ${R} 0 0 ${convex} ${x(S + R)} ${bottom}`,
    `L ${x(W - F)} ${bottom}`,
    `A ${F} ${F} 0 0 ${concave} ${x(W)} ${H}`
  ]
  if (closed) d.push('Z')
  return d.join(' ')
}
