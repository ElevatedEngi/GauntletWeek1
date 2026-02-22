import { ChatAnthropic } from '@langchain/anthropic';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { createWhiteboardTools } from './tools.js';
import type { ToolAction, PendingOperation } from './tools.js';
import { tryTemplateMatch } from './templates.js';
import type { TemplateRegion } from './templates.js';
import { v4 as uuidv4 } from 'uuid';
import { ObjectType } from '@whiteboard/shared-types';
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

CRITICAL FOR SPEED:
- ALWAYS call ALL tools in a SINGLE turn when possible. For example, if creating 5 sticky notes, call createStickyNote 5 times in ONE response, not 5 separate turns.
- When creating multiple objects, prefer the createMultipleObjects batch tool — it creates many objects in a single call.
- Use createSWOTAnalysis, createMultipleObjects, or other composite tools whenever applicable to minimize round-trips.

CONTENT GENERATION:
- When creating templates (SWOT, Kanban, etc.) or any grouped layout, ALWAYS generate relevant text content for the items inside.
- Use the populateRegion tool to fill rectangular sections with topical sticky notes. For example, a SWOT analysis about "Tesla" should have sticky notes like "Strong brand recognition" in the Strengths quadrant.
- If the user mentions a topic (e.g., "SWOT analysis for my coffee shop"), generate 2-4 specific, relevant items per section.
- If no topic is specified, generate generic placeholder items that demonstrate the template's purpose (e.g., "Team expertise" for Strengths).
- When creating sticky notes or text boxes, always include meaningful content text — never leave objects empty.

Guidelines:
- For positioning: The canvas uses pixel coordinates starting at (0,0) top-left. Use positions in the 100-800 range for x and 100-600 range for y. Space objects at least 170px apart horizontally and 120px apart vertically.
- For colors: Use pastel hex colors. Common options: yellow #FEF3C7, red #FEE2E2, green #DCFCE7, blue #DBEAFE, purple #E9D5FF, gray #F3F4F6
- When asked to do a SWOT analysis, use the createSWOTAnalysis tool, then IMMEDIATELY follow up by using populateRegion to fill each quadrant with relevant content.
- When you need context about what's on the board, call getBoardState first.
- After performing actions, give a brief summary of what you did.`;

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
    onProgress?: (ops: PendingOperation[]) => void,
  ): Promise<AICommandResponse> {
    // Fast-path: check if command matches a pre-built template
    const templateResult = tryTemplateMatch(command, boardId, userId);
    if (templateResult) {
      console.log(`[AI] Template fast-path matched for: "${command}"`);
      const regions = templateResult.result.regions;
      if (regions && regions.length > 0) {
        // Generate content for each region using a fast LLM call
        try {
          const contentOps = await this.generateRegionContent(command, regions, userId);
          templateResult.result.operations.push(...contentOps);
          templateResult.result.actions.push({
            tool: 'ai:fillContent',
            description: `Generated content for ${regions.length} regions`,
          });
        } catch (err) {
          console.warn('[AI] Content generation failed, returning empty template:', err);
        }
      }
      return templateResult;
    }

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

          if (langfuseHandler) try { await langfuseHandler.flushAsync?.(); } catch {}
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

        // Stream new operations to the frontend as they're created
        if (onProgress && pendingOps.length > 0) {
          onProgress(pendingOps.slice());
        }
      }

      if (langfuseHandler) try { await langfuseHandler.flushAsync?.(); } catch {}
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
        error: `Failed to execute AI command: ${errorMessage}`,
        fallback: 'Please try rephrasing your command',
      };
    }
  }
  async generateRegionContent(
    command: string,
    regions: TemplateRegion[],
    userId: string,
  ): Promise<PendingOperation[]> {
    const model = this.getModel();
    const contentModel = new ChatAnthropic({
      modelName: 'claude-sonnet-4-20250514',
      anthropicApiKey: model.apiKey as string,
      maxTokens: 1024,
      temperature: 0.5,
    });

    const regionList = regions.map((r) => r.label).join(', ');
    const response = await contentModel.invoke([
      new SystemMessage(
        `You generate content for whiteboard template regions. Return ONLY valid JSON — no markdown, no code fences, no explanation.

The user's command: "${command}"
The template has these regions: ${regionList}

Return a JSON object where each key is a region label and the value is an array of 2-4 short text items (max 6 words each) relevant to that region and the user's topic.

Example for a SWOT about "coffee shop":
{"Strengths":["Prime downtown location","Loyal customer base","Unique recipes"],"Weaknesses":["High rent costs","Limited seating"],"Opportunities":["Catering services","Online ordering"],"Threats":["New competitor nearby","Rising bean prices"]}`
      ),
      new HumanMessage(command),
    ]);

    const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    // Strip markdown fences if present
    const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    const contentMap: Record<string, string[]> = JSON.parse(cleaned);

    const ops: PendingOperation[] = [];
    for (const region of regions) {
      const items = contentMap[region.label];
      if (!items || !Array.isArray(items)) continue;

      const noteW = 120;
      const noteH = 55;
      const pad = 8;
      const cols = Math.max(1, Math.floor((region.width - pad) / (noteW + pad)));

      for (let i = 0; i < items.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        ops.push({
          type: 'create',
          object: {
            id: uuidv4(),
            type: ObjectType.STICKY_NOTE,
            position: {
              x: region.x + pad + col * (noteW + pad),
              y: region.y + pad + row * (noteH + pad),
            },
            width: noteW,
            height: noteH,
            rotation: 0,
            content: items[i],
            color: region.color,
            userId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }
    }
    return ops;
  }

  async previewCommand(
    command: string,
    boardId: string,
    boardObjects?: Record<string, BoardObject>,
  ): Promise<{ plan: string; objectCount: number }> {
    const model = this.getModel();

    const previewModel = new ChatAnthropic({
      modelName: 'claude-sonnet-4-20250514',
      anthropicApiKey: model.apiKey as string,
      maxTokens: 200,
      temperature: 0,
    });

    const existingCount = boardObjects ? Object.keys(boardObjects).length : 0;

    const response = await previewModel.invoke([
      new SystemMessage(
        `You are a whiteboard assistant. The user wants to perform an action on a whiteboard that currently has ${existingCount} objects.
Describe in 1-2 SHORT sentences what you will create/modify. Include the approximate number of objects.
Format: "I'll create [description]. This will add ~[N] objects to the board."
Do NOT use tools. Do NOT execute anything. Just describe the plan.`,
      ),
      new HumanMessage(command),
    ]);

    const plan =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    const countMatch = plan.match(/~?(\d+)\s*object/i);
    const objectCount = countMatch ? parseInt(countMatch[1], 10) : 0;

    return { plan, objectCount };
  }
}

export const aiAgent = new AIAgent();
