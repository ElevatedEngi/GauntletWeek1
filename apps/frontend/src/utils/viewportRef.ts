/**
 * Module-level singleton holding the current Fabric.js viewport transform.
 * Written by WhiteboardCanvas on every pan/zoom frame (via syncCssGrid).
 * Read by BoardPage (cursor broadcast) and CursorOverlay (cursor display).
 *
 * Using a plain object ref rather than React state avoids triggering
 * re-renders at 60fps during pan/zoom.
 *
 * Transform format: [scaleX, 0, 0, scaleY, translateX, translateY]
 */
export const viewportRef = { current: [1, 0, 0, 1, 0, 0] as number[] };
