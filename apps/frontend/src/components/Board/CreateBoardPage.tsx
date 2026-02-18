import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import useAuthStore from '../../stores/authStore';

/**
 * Creates a new board in Firestore then immediately redirects to it.
 * Exists as a separate component so that BoardPage always receives a valid boardId.
 */
const CreateBoardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const creating = useRef(false);

  useEffect(() => {
    if (!user || creating.current) return;
    creating.current = true;

    const boardId = crypto.randomUUID();
    const boardRef = doc(db, 'boards', boardId);

    setDoc(boardRef, {
      name: `Board - ${new Date().toLocaleString()}`,
      ownerId: user.id,
      collaborators: [],
      isPublic: false,
      objects: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
      .then(() => {
        navigate(`/board/${boardId}`, { replace: true });
      })
      .catch((err) => {
        console.error('Failed to create board:', err);
        creating.current = false;
      });
  }, [user, navigate]);

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <p className="text-gray-500 text-lg mb-4">Creating your board...</p>
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    </div>
  );
};

export default CreateBoardPage;
