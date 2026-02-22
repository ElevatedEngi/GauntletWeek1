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
        store.addObject(op.object);
        const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${op.object.id}`);
        set(objectRef, op.object).catch(console.error);
      } else if (op.type === 'update' && op.objectId && op.updates) {
        store.updateObject(op.objectId, op.updates);
        const objectRef = ref(realtimeDb, `boards/${boardId}/objects/${op.objectId}`);
        update(objectRef, op.updates).catch(console.error);
      }
    }
  };

  const handleSubmitStream = async (token: string, boardObjects: Record<string, BoardObject>) => {
    const apiUrl = import.meta.env.VITE_API_URL || '';
    const response = await fetch(`${apiUrl}/api/ai/execute-command-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ command, boardId, boardObjects }),
    });

    if (!response.ok) {
      throw new Error('Failed to execute command');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: { message?: string; actions?: ToolAction[]; operations?: PendingOperation[] } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === 'operations') {
            // Render objects immediately as they arrive
            await executeOperations(event.operations);
            setResult(`Creating objects... (${event.operations.length} new)`);
          } else if (event.type === 'done' && event.result) {
            finalResult = event.result.result || event.result;
            // Execute any remaining operations not already streamed
            const ops: PendingOperation[] = finalResult?.operations || (event.result.result?.operations) || [];
            if (ops.length > 0) {
              await executeOperations(ops);
            }
          } else if (event.type === 'error') {
            throw new Error(event.error || 'Stream error');
          }
        } catch (parseErr) {
          // Ignore SSE parse errors for partial data
        }
      }
    }

    return finalResult;
  };

  const handleSubmitFallback = async (token: string, boardObjects: Record<string, BoardObject>) => {
    const apiUrl = import.meta.env.VITE_API_URL || '';
    const response = await fetch(`${apiUrl}/api/ai/execute-command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ command, boardId, boardObjects }),
    });

    if (!response.ok) {
      throw new Error('Failed to execute command');
    }

    const data = await response.json();

    if (data.success && data.result) {
      const operations: PendingOperation[] = data.result.operations || [];
      if (operations.length > 0) {
        await executeOperations(operations);
      }
      return data.result;
    } else {
      throw new Error(data.error || 'Command failed');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    setIsLoading(true);
    setResult(null);

    try {
      const storeObjects = useBoardStore.getState().objects;
      const boardObjects: Record<string, BoardObject> = {};
      storeObjects.forEach((obj, id) => {
        boardObjects[id] = obj;
      });

      if (!auth.currentUser) {
        setResult('Error: You must be signed in to use AI commands');
        setIsLoading(false);
        return;
      }

      const token = await auth.currentUser.getIdToken();

      // Try streaming first, fall back to standard request
      let finalResult: any;
      try {
        finalResult = await handleSubmitStream(token, boardObjects);
      } catch {
        finalResult = await handleSubmitFallback(token, boardObjects);
      }

      if (finalResult) {
        const message = finalResult.message || 'Command executed';
        const actions: ToolAction[] = finalResult.actions || [];
        if (actions.length > 0) {
          const actionLines = actions
            .map((a: ToolAction) => `  - ${a.description}`)
            .join('\n');
          setResult(`${message}\n\nActions:\n${actionLines}`);
        } else {
          setResult(message);
        }
      }

      setCommand('');
    } catch (error) {
      console.error('Failed to execute command:', error);
      setResult(`Error: ${error instanceof Error ? error.message : 'Failed to execute command'}`);
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
        {isLoading ? 'Generating...' : 'Execute'}
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
