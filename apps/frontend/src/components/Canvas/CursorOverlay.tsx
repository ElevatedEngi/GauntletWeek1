import React from 'react';
import useBoardStore from '../../stores/boardStore';
import useAuthStore from '../../stores/authStore';

const CursorOverlay: React.FC = () => {
  const { cursors } = useBoardStore();
  const { user } = useAuthStore();

  return (
    <div className="absolute inset-0 pointer-events-none z-50">
      {Array.from(cursors.values())
        .filter((cursor) => cursor.userId !== user?.id) // Don't show own cursor
        .map((cursor) => (
          <div
            key={cursor.userId}
            className="absolute transition-transform duration-75 ease-linear"
            style={{
              transform: `translate(${cursor.position.x}px, ${cursor.position.y}px)`,
            }}
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
