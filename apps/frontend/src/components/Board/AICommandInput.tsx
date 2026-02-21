import React, { useState } from 'react';
import { ref, set, update } from 'firebase/database';
import { auth, realtimeDb } from '../../services/firebase';
import useBoardStore from '../../stores/boardStore';
import type { BoardObject } from '@whiteboard/shared-types';

interface AICommandInputProps {
  boardId: string;
}

interface ToolAction {
  tool: string;
  description: string;
  objectId?: string;
}

interface PendingOperation {
  type: 'create' | 'update';
  object?: BoardObject;
  objectId?: string;
  updates?: Partial<BoardObject>;
}

const AICommandInput: React.FC<AICommandInputProps> = ({ boardId }) => {
  const [command, setCommand] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const executeOperations = async (operations: PendingOperation[]) => {
    const store = useBoardStore.getState();

    for (const op of operations) {
      if (op.type === 'create' && op.object) {
        // Add to Zustand store for immediate rendering
        store.addObject(op.object);
        // Write to Firebase RTDB
        const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${op.object.id}`);
        set(objectRef, op.object).catch(console.error);
      } else if (op.type === 'update' && op.objectId && op.updates) {
        // Update Zustand store
        store.updateObject(op.objectId, op.updates);
        // Update Firebase RTDB
        const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${op.objectId}`);
        update(objectRef, op.updates).catch(console.error);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    setIsLoading(true);
    setResult(null);

    try {
      // Gather current board objects for AI context
      const storeObjects = useBoardStore.getState().objects;
      const boardObjects: Record<string, BoardObject> = {};
      storeObjects.forEach((obj, id) => {
        boardObjects[id] = obj;
      });

      const token = await auth.currentUser?.getIdToken() ?? null;
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/ai/execute-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ command, boardId, boardObjects }),
      });

      if (!response.ok) {
        throw new Error('Failed to execute command');
      }

      const data = await response.json();

      if (data.success && data.result) {
        // Execute pending operations on Firebase
        const operations: PendingOperation[] = data.result.operations || [];
        if (operations.length > 0) {
          await executeOperations(operations);
        }

        const message = data.result.message || 'Command executed';
        const actions: ToolAction[] = data.result.actions || [];
        if (actions.length > 0) {
          const actionLines = actions
            .map((a: ToolAction) => `  - ${a.description}`)
            .join('\n');
          setResult(`${message}\n\nActions:\n${actionLines}`);
        } else {
          setResult(message);
        }
      } else {
        setResult(`Error: ${data.error || 'Command failed'}`);
      }

      setCommand('');
    } catch (error) {
      console.error('Failed to execute command:', error);
      setResult('Error: Failed to execute command');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">AI Command</label>
      <textarea
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        placeholder="e.g. 'Create a SWOT analysis' or 'Add 3 sticky notes about project goals'"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        rows={3}
        disabled={isLoading}
      />
      <button
        type="submit"
        disabled={isLoading || !command.trim()}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition"
      >
        {isLoading ? 'Executing...' : 'Execute'}
      </button>
      {result && (
        <div className="p-2 bg-gray-50 rounded text-xs text-gray-700 border border-gray-200 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {result}
        </div>
      )}
    </form>
  );
};

export default AICommandInput;
