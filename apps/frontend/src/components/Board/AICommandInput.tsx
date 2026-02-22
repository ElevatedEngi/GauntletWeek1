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

interface Preview {
  type: 'template' | 'ai';
  name: string;
  plan: string;
  objectCount: number;
}

// ─── Client-side intent detection (Solution 1) ───
// Patterns matched instantly on the client, no API call needed
const CLIENT_PATTERNS: { pattern: RegExp; name: string; description: string; objectCount: number }[] = [
  { pattern: /\bswot\b/i, name: 'SWOT Analysis', description: 'Create a 4-quadrant SWOT grid with Strengths, Weaknesses, Opportunities, and Threats.', objectCount: 8 },
  { pattern: /\bkanban\b/i, name: 'Kanban Board', description: 'Create a 4-column board with To Do, In Progress, Review, and Done columns.', objectCount: 8 },
  { pattern: /\bpros?\s*(and|&|\/)\s*cons?\b/i, name: 'Pros & Cons', description: 'Create a 2-column comparison layout with green Pros and red Cons sections.', objectCount: 4 },
  { pattern: /\btimeline\b/i, name: 'Timeline', description: 'Create a horizontal timeline with 5 milestone markers.', objectCount: 11 },
  { pattern: /\beisenhower\b/i, name: 'Eisenhower Matrix', description: 'Create a 4-quadrant Urgent/Important priority grid.', objectCount: 8 },
  { pattern: /\bbrain\s*storm/i, name: 'Brainstorm Grid', description: 'Create a 3x2 grid of 6 colorful sticky notes for brainstorming.', objectCount: 6 },
];

function detectClientIntent(command: string): Preview | null {
  for (const p of CLIENT_PATTERNS) {
    if (p.pattern.test(command)) {
      return { type: 'template', name: p.name, plan: p.description, objectCount: p.objectCount };
    }
  }
  return null;
}

// ─── Suggestion chips (Solution 2) ───
const SUGGESTIONS = [
  { label: 'SWOT Analysis', command: 'Create a SWOT analysis' },
  { label: 'Kanban Board', command: 'Create a Kanban board' },
  { label: 'Brainstorm', command: 'Brainstorm ideas' },
  { label: 'Pros & Cons', command: 'Create a pros and cons list' },
  { label: 'Timeline', command: 'Create a timeline' },
  { label: 'Eisenhower Matrix', command: 'Create an Eisenhower matrix' },
];

type Stage = 'input' | 'previewing' | 'confirming' | 'executing';

const AICommandInput: React.FC<AICommandInputProps> = ({ boardId }) => {
  const [command, setCommand] = useState('');
  const [stage, setStage] = useState<Stage>('input');
  const [preview, setPreview] = useState<Preview | null>(null);
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

  const getToken = async () => {
    if (!auth.currentUser) throw new Error('You must be signed in');
    return auth.currentUser.getIdToken();
  };

  // ─── Solution 3: Preview (plan-then-execute) ───
  const fetchPreview = async (cmd: string): Promise<Preview> => {
    // Try client-side detection first (instant, 0ms)
    const clientPreview = detectClientIntent(cmd);
    if (clientPreview) return clientPreview;

    // Fall back to backend LLM preview
    const token = await getToken();
    const apiUrl = import.meta.env.VITE_API_URL || '';
    const storeObjects = useBoardStore.getState().objects;
    const boardObjects: Record<string, BoardObject> = {};
    storeObjects.forEach((obj, id) => { boardObjects[id] = obj; });

    const response = await fetch(`${apiUrl}/api/ai/preview-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ command: cmd, boardId, boardObjects }),
    });
    if (!response.ok) throw new Error('Failed to preview command');
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Preview failed');
    return data.preview;
  };

  const executeCommand = async (cmd: string) => {
    const token = await getToken();
    const apiUrl = import.meta.env.VITE_API_URL || '';
    const storeObjects = useBoardStore.getState().objects;
    const boardObjects: Record<string, BoardObject> = {};
    storeObjects.forEach((obj, id) => { boardObjects[id] = obj; });

    // Try streaming first
    try {
      const response = await fetch(`${apiUrl}/api/ai/execute-command-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: cmd, boardId, boardObjects }),
      });
      if (!response.ok) throw new Error('Stream failed');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream');

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
              await executeOperations(event.operations);
            } else if (event.type === 'done' && event.result) {
              finalResult = event.result.result || event.result;
              const ops: PendingOperation[] = finalResult?.operations || (event.result.result?.operations) || [];
              if (ops.length > 0) await executeOperations(ops);
            } else if (event.type === 'error') {
              throw new Error(event.error || 'Stream error');
            }
          } catch { /* ignore parse errors */ }
        }
      }
      return finalResult;
    } catch {
      // Fallback to standard endpoint
      const response = await fetch(`${apiUrl}/api/ai/execute-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: cmd, boardId, boardObjects }),
      });
      if (!response.ok) throw new Error('Failed to execute command');
      const data = await response.json();
      if (data.success && data.result) {
        const ops: PendingOperation[] = data.result.operations || [];
        if (ops.length > 0) await executeOperations(ops);
        return data.result;
      }
      throw new Error(data.error || 'Command failed');
    }
  };

  // ─── Step 1: User submits → get preview ───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || stage !== 'input') return;

    setResult(null);
    setStage('previewing');

    try {
      const p = await fetchPreview(command);
      setPreview(p);
      setStage('confirming');
    } catch (error) {
      setResult(`Error: ${error instanceof Error ? error.message : 'Failed to preview'}`);
      setStage('input');
    }
  };

  // ─── Step 2: User confirms → execute ───
  const handleConfirm = async () => {
    if (!preview) return;
    setStage('executing');
    setResult(null);

    try {
      const finalResult = await executeCommand(command);
      if (finalResult) {
        const message = finalResult.message || 'Command executed';
        const actions: ToolAction[] = finalResult.actions || [];
        if (actions.length > 0) {
          const actionLines = actions.map((a: ToolAction) => `  - ${a.description}`).join('\n');
          setResult(`${message}\n\nActions:\n${actionLines}`);
        } else {
          setResult(message);
        }
      }
      setCommand('');
    } catch (error) {
      setResult(`Error: ${error instanceof Error ? error.message : 'Failed to execute'}`);
    } finally {
      setStage('input');
      setPreview(null);
    }
  };

  const handleCancel = () => {
    setStage('input');
    setPreview(null);
  };

  const handleSuggestionClick = (cmd: string) => {
    setCommand(cmd);
  };

  const isDisabled = stage !== 'input';

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">AI Command</label>

      {/* ── Suggestion Chips (Solution 2) ── */}
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={isDisabled}
            onClick={() => handleSuggestionClick(s.command)}
            className="px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 rounded-full border border-blue-200 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition whitespace-nowrap"
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Input Form ── */}
      <form onSubmit={handleSubmit}>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="e.g. 'Create a SWOT analysis' or 'Add 3 sticky notes about project goals'"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm"
          rows={2}
          disabled={isDisabled}
        />

        {/* ── Confirmation Card (Solutions 1 & 3) ── */}
        {stage === 'confirming' && preview && (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 shrink-0">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-blue-800">{preview.name}</p>
                <p className="text-xs text-blue-700 mt-0.5">{preview.plan}</p>
                <p className="text-[10px] text-blue-500 mt-1">
                  {preview.type === 'template' ? 'Instant template' : 'AI-generated'} · ~{preview.objectCount} objects
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-2.5">
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1.5 text-xs font-medium bg-white text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition"
              >
                Edit
              </button>
            </div>
          </div>
        )}

        {/* ── Submit / Status Button ── */}
        {stage !== 'confirming' && (
          <button
            type="submit"
            disabled={isDisabled || !command.trim()}
            className="w-full mt-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition text-sm"
          >
            {stage === 'previewing' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Analyzing...
              </span>
            ) : stage === 'executing' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating...
              </span>
            ) : (
              'Preview & Execute'
            )}
          </button>
        )}
      </form>

      {/* ── Result ── */}
      {result && (
        <div className={`p-2 rounded text-xs border whitespace-pre-wrap max-h-40 overflow-y-auto ${
          result.startsWith('Error') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200'
        }`}>
          {result}
        </div>
      )}
    </div>
  );
};

export default AICommandInput;
