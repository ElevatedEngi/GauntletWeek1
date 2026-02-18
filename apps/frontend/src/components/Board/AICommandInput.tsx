import React, { useState } from 'react';
import { auth } from '../../services/firebase';

interface AICommandInputProps {
  boardId: string;
}

const AICommandInput: React.FC<AICommandInputProps> = ({ boardId }) => {
  const [command, setCommand] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    setIsLoading(true);
    setResult(null);

    try {
      const token = await auth.currentUser?.getIdToken() ?? null;
      const response = await fetch('/api/ai/execute-command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ command, boardId }),
      });

      if (!response.ok) {
        throw new Error('Failed to execute command');
      }

      const data = await response.json();
      setResult(data.success ? '✅ Command executed' : `❌ ${data.error || 'Command failed'}`);
      setCommand('');
    } catch (error) {
      console.error('Failed to execute command:', error);
      setResult('❌ Failed to execute command');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">🤖 AI Command</label>
      <textarea
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        placeholder="Describe what you want to do... e.g., 'Create a sticky note saying hello'"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        rows={3}
        disabled={isLoading}
      />
      <button
        type="submit"
        disabled={isLoading || !command.trim()}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition"
      >
        {isLoading ? '⏳ Executing...' : '⚡ Execute'}
      </button>
      {result && (
        <div className="p-2 bg-gray-50 rounded text-xs text-gray-700 border border-gray-200">
          {result}
        </div>
      )}
    </form>
  );
};

export default AICommandInput;
