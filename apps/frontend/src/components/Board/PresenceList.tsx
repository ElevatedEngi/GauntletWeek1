import React, { useState } from 'react';
import useBoardStore from '../../stores/boardStore';
import useAuthStore, { CURSOR_COLORS } from '../../stores/authStore';

const PresenceList: React.FC = () => {
  const { presenceUsers } = useBoardStore();
  const { user: currentUser, cursorColor, setCursorColor } = useAuthStore();
  const [showColorPicker, setShowColorPicker] = useState(false);

  const onlineUsers = Array.from(presenceUsers.values()).filter((u) => u.status === 'online');

  if (onlineUsers.length === 0) {
    return <div className="text-gray-400 text-sm">No users online</div>;
  }

  const handleColorSelect = (color: string) => {
    setCursorColor(color);
    setShowColorPicker(false);
  };

  return (
    <div className="space-y-2">
      {onlineUsers.map((user) => {
        const isCurrentUser = user.userId === currentUser?.id;

        return (
          <div key={user.userId} className="relative">
            <div
              className={`flex items-center gap-2 p-2 rounded transition-colors ${
                isCurrentUser
                  ? 'bg-blue-50 hover:bg-blue-100 cursor-pointer'
                  : 'bg-gray-50'
              }`}
              onClick={() => isCurrentUser && setShowColorPicker(!showColorPicker)}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: isCurrentUser ? cursorColor : '#10B981' }}
              ></div>
              <span className="text-sm font-medium text-gray-700">
                {user.userName}
                {isCurrentUser && ' (You)'}
              </span>
              {isCurrentUser && (
                <svg
                  className="w-4 h-4 ml-auto text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                  />
                </svg>
              )}
            </div>

            {/* Color Picker Dropdown */}
            {isCurrentUser && showColorPicker && (
              <div className="absolute top-full mt-2 left-0 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-3 w-64">
                <div className="text-xs font-semibold text-gray-600 mb-2">Choose Cursor Color</div>
                <div className="grid grid-cols-4 gap-2">
                  {CURSOR_COLORS.map((color) => (
                    <button
                      key={color.value}
                      onClick={() => handleColorSelect(color.value)}
                      className={`w-12 h-12 rounded-lg transition-all hover:scale-110 ${
                        cursorColor === color.value
                          ? 'ring-2 ring-offset-2 ring-blue-500'
                          : 'hover:ring-2 hover:ring-gray-300'
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.name}
                    >
                      {cursorColor === color.value && (
                        <svg
                          className="w-6 h-6 m-auto text-white drop-shadow-md"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PresenceList;
