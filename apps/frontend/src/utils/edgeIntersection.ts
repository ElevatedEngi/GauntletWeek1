export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Find where a line from the rectangle's center to (targetX, targetY)
 * intersects the rectangle boundary.
 */
export function rectEdgeIntersection(
  rect: Rect,
  targetX: number,
  targetY: number,
): { x: number; y: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  const scaleX = halfW / (Math.abs(dx) || 0.001);
  const scaleY = halfH / (Math.abs(dy) || 0.001);
  const scale = Math.min(scaleX, scaleY);

  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * Find where a line from a circle's center to (targetX, targetY)
 * intersects the circle boundary.
 */
export function circleEdgeIntersection(
  cx: number,
  cy: number,
  radius: number,
  targetX: number,
  targetY: number,
): { x: number; y: number } {
  const dx = targetX - cx;
  const dy = targetY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x: cx + radius, y: cy };
  return {
    x: cx + (dx / dist) * radius,
    y: cy + (dy / dist) * radius,
  };
}
