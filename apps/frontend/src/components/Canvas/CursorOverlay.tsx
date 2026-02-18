import React, { useEffect, useRef } from 'react';
import useBoardStore from '../../stores/boardStore';
import useAuthStore from '../../stores/authStore';
import { viewportRef } from '../../utils/viewportRef';

/**
 * Renders remote user cursors positioned in canvas coordinate space.
 *
 * Cursor positions stored in Firebase are canvas coords (pan/zoom-aware).
 * A requestAnimationFrame loop converts them to screen coords using the
 * current viewportRef on every frame — so cursors move smoothly with the
 * local user's pan/zoom without triggering any React re-renders.
 */
const CursorOverlay: React.FC = () => {
  const { cursors } = useBoardStore();
  const { user } = useAuthStore();

  // Map of userId → ref to its wrapper DOM element
  const elRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafRef = useRef<number | null>(null);

  // rAF loop: convert canvas→screen for each cursor and write to DOM directly
  useEffect(() => {
    const tick = () => {
      const vp = viewportRef.current;
      elRefs.current.forEach((el) => {
        const cx = parseFloat(el.dataset.cx || '0');
        const cy = parseFloat(el.dataset.cy || '0');
        const sx = cx * vp[0] + vp[4];
        const sy = cy * vp[3] + vp[5];
        el.style.transform = `translate(${sx}px, ${sy}px)`;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const remoteCursors = Array.from(cursors.values()).filter(
    (c) => c.userId !== user?.id
  );

  return (
    <div className="absolute inset-0 pointer-events-none z-50">
      {remoteCursors.map((cursor) => (
        <div
          key={cursor.userId}
          ref={(el) => {
            if (el) {
              elRefs.current.set(cursor.userId, el);
            } else {
              elRefs.current.delete(cursor.userId);
            }
          }}
          className="absolute"
          // Store canvas coords as data attrs; rAF reads them each frame
          data-cx={cursor.position.x}
          data-cy={cursor.position.y}
          style={{ willChange: 'transform' }}
        >
          {/* Cursor pointer */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
          >
            <path
              d="M5.65376 12.3673L11.6501 2.00928C11.8632 1.65874 12.3508 1.65874 12.564 2.00928L18.5603 12.3673C18.7737 12.7186 18.5219 13.1705 18.1103 13.1705H12.114L11.9999 21.9999L5.89332 13.1705C5.48175 13.1705 5.22999 12.7186 5.44348 12.3673H5.65376Z"
              fill={cursor.color}
              stroke="white"
              strokeWidth="1.5"
            />
          </svg>

          {/* User name label */}
          <div
            className="absolute top-6 left-4 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shadow-lg border-2 border-white"
            style={{
              backgroundColor: cursor.color,
              color: '#ffffff',
              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }}
          >
            {cursor.userName}
          </div>
        </div>
      ))}
    </div>
  );
};

export default CursorOverlay;
