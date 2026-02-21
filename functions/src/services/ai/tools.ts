import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ObjectType } from '../types';
import type { BoardObject } from '../types';

export interface ToolAction {
  tool: string;
  description: string;
  objectId?: string;
}

export interface PendingOperation {
  type: 'create' | 'update';
  object?: BoardObject;
  objectId?: string;
  updates?: Partial<BoardObject>;
}

export function createWhiteboardTools(
  boardId: string,
  userId: string,
  boardObjects: Record<string, BoardObject>,
) {
  const actions: ToolAction[] = [];
  const pendingOps: PendingOperation[] = [];

  const createStickyNote = tool(
    async ({ text, x, y, color }) => {
      const id = uuidv4();
      const obj: BoardObject = {
        id,
        type: ObjectType.STICKY_NOTE,
        position: { x, y },
        width: 150,
        height: 100,
        rotation: 0,
        content: text,
        color: color || '#FEF3C7',
        userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      pendingOps.push({ type: 'create', object: obj });
      actions.push({
        tool: 'createStickyNote',
        description: `Created sticky note "${text}"`,
        objectId: id,
      });
      return JSON.stringify({ success: true, objectId: id });
    },
    {
      name: 'createStickyNote',
      description:
        'Create a sticky note on the whiteboard with the given text, position, and color.',
      schema: z.object({
        text: z.string().describe('The text content of the sticky note'),
        x: z.number().describe('X position on the canvas'),
        y: z.number().describe('Y position on the canvas'),
        color: z
          .string()
          .optional()
          .describe(
            'Background color (hex). Defaults to yellow (#FEF3C7). Options: red #FEE2E2, green #DCFCE7, blue #DBEAFE, purple #E9D5FF',
          ),
      }),
    },
  );

  const createShape = tool(
    async ({ type, x, y, width, height, color }) => {
      const id = uuidv4();
      const objType =
        type === 'rectangle'
          ? ObjectType.RECTANGLE
          : type === 'circle'
            ? ObjectType.CIRCLE
            : ObjectType.ARROW;
      const obj: BoardObject = {
        id,
        type: objType,
        position: { x, y },
        width: width || 150,
        height: height || 100,
        rotation: 0,
        content: '',
        color: color || '#DBEAFE',
        userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      pendingOps.push({ type: 'create', object: obj });
      actions.push({
        tool: 'createShape',
        description: `Created ${type} at (${x}, ${y})`,
        objectId: id,
      });
      return JSON.stringify({ success: true, objectId: id });
    },
    {
      name: 'createShape',
      description:
        'Create a shape (rectangle, circle, or arrow) on the whiteboard.',
      schema: z.object({
        type: z.enum(['rectangle', 'circle', 'arrow']).describe('Shape type'),
        x: z.number().describe('X position'),
        y: z.number().describe('Y position'),
        width: z.number().optional().describe('Width in pixels (default 150)'),
        height: z
          .number()
          .optional()
          .describe('Height in pixels (default 100)'),
        color: z
          .string()
          .optional()
          .describe('Fill color (hex). Default: #DBEAFE (light blue)'),
      }),
    },
  );

  const createFrame = tool(
    async ({ title, x, y, width, height }) => {
      const frameId = uuidv4();
      const titleId = uuidv4();
      const fw = width || 400;
      const fh = height || 300;

      const frameObj: BoardObject = {
        id: frameId,
        type: ObjectType.RECTANGLE,
        position: { x, y },
        width: fw,
        height: fh,
        rotation: 0,
        content: '',
        color: '#F3F4F6',
        userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const titleObj: BoardObject = {
        id: titleId,
        type: ObjectType.TEXT_BOX,
        position: { x, y: y - 35 },
        width: fw,
        height: 30,
        rotation: 0,
        content: title,
        color: '#1F2937',
        userId,
        fontSize: 18,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      pendingOps.push({ type: 'create', object: frameObj });
      pendingOps.push({ type: 'create', object: titleObj });
      actions.push({
        tool: 'createFrame',
        description: `Created frame "${title}"`,
        objectId: frameId,
      });
      return JSON.stringify({ success: true, frameId, titleId });
    },
    {
      name: 'createFrame',
      description:
        'Create a labeled frame (large rectangle with a title above it). Useful for grouping objects.',
      schema: z.object({
        title: z.string().describe('Title text displayed above the frame'),
        x: z.number().describe('X position of the frame'),
        y: z.number().describe('Y position of the frame'),
        width: z.number().optional().describe('Frame width (default 400)'),
        height: z.number().optional().describe('Frame height (default 300)'),
      }),
    },
  );

  const createConnectorTool = tool(
    async ({ fromId, toId, style }) => {
      const id = uuidv4();
      const obj: BoardObject = {
        id,
        type: ObjectType.CONNECTOR,
        position: { x: 0, y: 0 },
        width: 0,
        height: 0,
        rotation: 0,
        content: '',
        color: '#6b7280',
        userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceObjectId: fromId,
        targetObjectId: toId,
        connectorStyle: style || 'arrow',
      };
      pendingOps.push({ type: 'create', object: obj });
      actions.push({
        tool: 'createConnector',
        description: `Connected ${fromId.slice(0, 8)}... -> ${toId.slice(0, 8)}...`,
        objectId: id,
      });
      return JSON.stringify({ success: true, objectId: id });
    },
    {
      name: 'createConnector',
      description:
        'Create a line or arrow connecting two existing objects on the board.',
      schema: z.object({
        fromId: z.string().describe('The ID of the source object'),
        toId: z.string().describe('The ID of the target object'),
        style: z
          .enum(['line', 'arrow'])
          .optional()
          .describe('Connector style (default: arrow)'),
      }),
    },
  );

  const moveObject = tool(
    async ({ objectId, x, y }) => {
      pendingOps.push({
        type: 'update',
        objectId,
        updates: { position: { x, y }, updatedAt: Date.now() },
      });
      actions.push({
        tool: 'moveObject',
        description: `Moved object to (${x}, ${y})`,
        objectId,
      });
      return JSON.stringify({ success: true });
    },
    {
      name: 'moveObject',
      description: 'Move an existing object to a new position.',
      schema: z.object({
        objectId: z.string().describe('The ID of the object to move'),
        x: z.number().describe('New X position'),
        y: z.number().describe('New Y position'),
      }),
    },
  );

  const resizeObject = tool(
    async ({ objectId, width, height }) => {
      pendingOps.push({
        type: 'update',
        objectId,
        updates: { width, height, updatedAt: Date.now() },
      });
      actions.push({
        tool: 'resizeObject',
        description: `Resized object to ${width}x${height}`,
        objectId,
      });
      return JSON.stringify({ success: true });
    },
    {
      name: 'resizeObject',
      description: 'Resize an existing object to new dimensions.',
      schema: z.object({
        objectId: z.string().describe('The ID of the object to resize'),
        width: z.number().describe('New width in pixels'),
        height: z.number().describe('New height in pixels'),
      }),
    },
  );

  const updateText = tool(
    async ({ objectId, newText }) => {
      pendingOps.push({
        type: 'update',
        objectId,
        updates: { content: newText, updatedAt: Date.now() },
      });
      actions.push({
        tool: 'updateText',
        description: `Updated text of object`,
        objectId,
      });
      return JSON.stringify({ success: true });
    },
    {
      name: 'updateText',
      description: 'Change the text content of an existing object.',
      schema: z.object({
        objectId: z.string().describe('The ID of the object to update'),
        newText: z.string().describe('The new text content'),
      }),
    },
  );

  const changeColor = tool(
    async ({ objectId, color }) => {
      pendingOps.push({
        type: 'update',
        objectId,
        updates: { color, updatedAt: Date.now() },
      });
      actions.push({
        tool: 'changeColor',
        description: `Changed color to ${color}`,
        objectId,
      });
      return JSON.stringify({ success: true });
    },
    {
      name: 'changeColor',
      description: 'Change the color of an existing object.',
      schema: z.object({
        objectId: z.string().describe('The ID of the object'),
        color: z.string().describe('New color in hex format (e.g., #FEE2E2)'),
      }),
    },
  );

  const getBoardState = tool(
    async () => {
      const summary = Object.values(boardObjects).map((obj) => ({
        id: obj.id,
        type: obj.type,
        content: obj.content,
        position: obj.position,
        width: obj.width,
        height: obj.height,
        color: obj.color,
      }));
      return JSON.stringify({ objectCount: summary.length, objects: summary });
    },
    {
      name: 'getBoardState',
      description:
        'Get the current state of all objects on the whiteboard. Use this to understand what exists before making changes.',
      schema: z.object({}),
    },
  );

  const createSWOTAnalysis = tool(
    async ({ x, y }) => {
      const quadrantW = 250;
      const quadrantH = 200;
      const gap = 20;
      const titleHeight = 35;
      const baseX = x || 100;
      const baseY = y || 100;

      const ids: string[] = [];

      const quadrants = [
        { label: 'Strengths', color: '#DCFCE7', col: 0, row: 0 },
        { label: 'Weaknesses', color: '#FEE2E2', col: 1, row: 0 },
        { label: 'Opportunities', color: '#DBEAFE', col: 0, row: 1 },
        { label: 'Threats', color: '#FEF3C7', col: 1, row: 1 },
      ];

      for (const q of quadrants) {
        const qx = baseX + q.col * (quadrantW + gap);
        const qy = baseY + q.row * (quadrantH + gap + titleHeight);

        const titleId = uuidv4();
        const titleObj: BoardObject = {
          id: titleId,
          type: ObjectType.TEXT_BOX,
          position: { x: qx, y: qy },
          width: quadrantW,
          height: titleHeight,
          rotation: 0,
          content: q.label,
          color: '#1F2937',
          userId,
          fontSize: 16,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const rectId = uuidv4();
        const rectObj: BoardObject = {
          id: rectId,
          type: ObjectType.RECTANGLE,
          position: { x: qx, y: qy + titleHeight },
          width: quadrantW,
          height: quadrantH,
          rotation: 0,
          content: '',
          color: q.color,
          userId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        pendingOps.push({ type: 'create', object: titleObj });
        pendingOps.push({ type: 'create', object: rectObj });
        ids.push(titleId, rectId);
      }

      actions.push({
        tool: 'createSWOTAnalysis',
        description: 'Created SWOT analysis (4 quadrants)',
      });
      return JSON.stringify({ success: true, objectIds: ids });
    },
    {
      name: 'createSWOTAnalysis',
      description:
        'Create a SWOT analysis with 4 labeled quadrants: Strengths (green, top-left), Weaknesses (red, top-right), Opportunities (blue, bottom-left), Threats (yellow, bottom-right).',
      schema: z.object({
        x: z
          .number()
          .optional()
          .describe('X position of top-left corner (default: 100)'),
        y: z
          .number()
          .optional()
          .describe('Y position of top-left corner (default: 100)'),
      }),
    },
  );

  const allTools = [
    createStickyNote,
    createShape,
    createFrame,
    createConnectorTool,
    moveObject,
    resizeObject,
    updateText,
    changeColor,
    getBoardState,
    createSWOTAnalysis,
  ];

  return { tools: allTools, actions, pendingOps };
}
