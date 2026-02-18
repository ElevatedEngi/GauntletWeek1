import React from 'react';
import useBoardStore from '../../stores/boardStore';

const CursorList: React.FC = () => {
  const { cursors } = useBoardStore();

  if (cursors.size === 0) {
    return <div className="text-gray-400 text-sm">No other cursors visible</div>;
  }

  return (
    <div className="space-y-2">
      {Array.from(cursors.values()).map((cursor) => (
        <div key={cursor.userId} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
          <div
            className="w-4 h-4 rounded"
            style={{ backgroundColor: cursor.color }}
          ></div>
          <span className="text-sm text-gray-600">{cursor.userName}</span>
          <span className="text-xs text-gray-400 ml-auto">
            ({Math.round(cursor.position.x)}, {Math.round(cursor.position.y)})
          </span>
        </div>
      ))}
    </div>
  );
};

export default CursorList;
