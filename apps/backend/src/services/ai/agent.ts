import { ChatAnthropic } from '@langchain/anthropic';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { createWhiteboardTools } from './tools.js';
import type { ToolAction, PendingOperation } from './tools.js';
import type { BoardObject } from '@whiteboard/shared-types';

interface AICommandResponse {
  success: boolean;
  result?: {
    message: string;
    boardId: string;
    actions: ToolAction[];
    operations: PendingOperation[];
  };
  error?: string;
  fallback?: string;
}

const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT = `You are an AI assistant for a collaborative whiteboard application.
You can create and manipulate objects on the whiteboard using the tools provided.

When a user asks you to do something on the whiteboard, USE THE TOOLS to actually do it.
Do not just describe what you would do — actually call the tools to make changes.

Guidelines:
- For positioning: The canvas uses pixel coordinates starting at (0,0) top-left. Use positions in the 100-800 range for x and 100-600 range for y. Space objects at least 170px apart horizontally and 120px apart vertically.
- For colors: Use pastel hex colors. Common options: yellow #FEF3C7, red #FEE2E2, green #DCFCE7, blue #DBEAFE, purple #E9D5FF, gray #F3F4F6
- When asked to do a SWOT analysis, use the createSWOTAnalysis tool.
- When you need context about what's on the board, call getBoardState first.
- After performing actions, give a brief summary of what you did.
- You can call multiple tools in a single turn to be efficient.`;

export class AIAgent {
  private model: ChatAnthropic | null = null;

  private getModel(): ChatAnthropic {
    if (this.model) {
      return this.model;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }

    this.model = new ChatAnthropic({
      modelName: 'claude-sonnet-4-20250514',
      anthropicApiKey: apiKey,
      maxTokens: 4096,
      temperature: 0.3,
    });

    return this.model;
  }

  async executeCommand(
    command: string,
    boardId: string,
    userId: string,
    boardObjects?: Record<string, BoardObject>,
  ): Promise<AICommandResponse> {
    try {
      const model = this.getModel();
      const { tools, actions, pendingOps } = createWhiteboardTools(
        boardId,
        userId,
        boardObjects || {},
      );

      const modelWithTools = model.bindTools(tools);

      const messages: BaseMessage[] = [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(command),
      ];

      // Langfuse tracing is optional — only enable if keys are configured
      const callbacks: any[] = [];
      let langfuseHandler: any = null;
      if (process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY) {
        try {
          const { CallbackHandler } = await import('@langfuse/langchain');
          langfuseHandler = new CallbackHandler({
            sessionId: boardId,
            userId,
            metadata: { command },
            tags: ['whiteboard-command'],
          });
          callbacks.push(langfuseHandler);
        } catch {
          console.warn('Langfuse not available, skipping tracing');
        }
      }

      let iterations = 0;
      while (iterations < MAX_ITERATIONS) {
        iterations++;

        const response = await modelWithTools.invoke(messages, {
          callbacks,
          metadata: {
            boardId,
            userId,
            command,
            iteration: iterations,
          },
          tags: ['whiteboard-command', `board:${boardId}`],
        });

        messages.push(response);

        const toolCalls = response.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          const content =
            typeof response.content === 'string'
              ? response.content
              : JSON.stringify(response.content);

          if (langfuseHandler) await langfuseHandler.shutdownAsync();
          return {
            success: true,
            result: {
              message: content,
              boardId,
              actions,
              operations: pendingOps,
            },
          };
        }

        for (const toolCall of toolCalls) {
          const matchingTool = tools.find((t) => t.name === toolCall.name);
          if (!matchingTool) {
            messages.push(
              new ToolMessage({
                tool_call_id: toolCall.id || '',
                content: JSON.stringify({
                  error: `Unknown tool: ${toolCall.name}`,
                }),
              }),
            );
            continue;
          }

          try {
            const toolResult = await matchingTool.invoke(toolCall);
            messages.push(
              new ToolMessage({
                tool_call_id: toolCall.id || '',
                content:
                  typeof toolResult === 'string'
                    ? toolResult
                    : JSON.stringify(toolResult),
              }),
            );
          } catch (toolError: unknown) {
            const errorMsg =
              toolError instanceof Error
                ? toolError.message
                : 'Tool execution failed';
            messages.push(
              new ToolMessage({
                tool_call_id: toolCall.id || '',
                content: JSON.stringify({ error: errorMsg }),
              }),
            );
          }
        }
      }

      await langfuseHandler.shutdownAsync();
      return {
        success: true,
        result: {
          message: `Completed ${actions.length} action(s) (reached max iterations).`,
          boardId,
          actions,
          operations: pendingOps,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';

      console.error('AI Command Error:', errorMessage);

      if (errorMessage.includes('ANTHROPIC_API_KEY')) {
        return {
          success: false,
          error: 'AI service is not configured',
          fallback:
            'Please configure the ANTHROPIC_API_KEY environment variable',
        };
      }

      return {
        success: false,
        error: 'Failed to execute AI command',
        fallback: 'Please try rephrasing your command',
      };
    }
  }
}

export const aiAgent = new AIAgent();
