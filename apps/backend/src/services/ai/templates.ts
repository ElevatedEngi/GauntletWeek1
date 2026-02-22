import { v4 as uuidv4 } from 'uuid';
import { ObjectType } from '@whiteboard/shared-types';
import type { BoardObject } from '@whiteboard/shared-types';
import type { ToolAction, PendingOperation } from './tools.js';

interface TemplateResult {
  message: string;
  actions: ToolAction[];
  operations: PendingOperation[];
}

function makeObj(
  partial: Partial<BoardObject> & { type: ObjectType },
  userId: string,
): BoardObject {
  const now = Date.now();
  return {
    id: uuidv4(),
    position: { x: 0, y: 0 },
    width: 150,
    height: 100,
    rotation: 0,
    content: '',
    color: '#DBEAFE',
    userId,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

// ─── SWOT Analysis ───
function buildSWOT(userId: string, x = 100, y = 100): TemplateResult {
  const ops: PendingOperation[] = [];
  const qW = 250, qH = 200, gap = 20, titleH = 35;
  const quadrants = [
    { label: 'Strengths', color: '#DCFCE7', col: 0, row: 0 },
    { label: 'Weaknesses', color: '#FEE2E2', col: 1, row: 0 },
    { label: 'Opportunities', color: '#DBEAFE', col: 0, row: 1 },
    { label: 'Threats', color: '#FEF3C7', col: 1, row: 1 },
  ];
  for (const q of quadrants) {
    const qx = x + q.col * (qW + gap);
    const qy = y + q.row * (qH + gap + titleH);
    ops.push({
      type: 'create',
      object: makeObj({ type: ObjectType.TEXT_BOX, position: { x: qx, y: qy }, width: qW, height: titleH, content: q.label, color: '#1F2937', fontSize: 16 }, userId),
    });
    ops.push({
      type: 'create',
      object: makeObj({ type: ObjectType.RECTANGLE, position: { x: qx, y: qy + titleH }, width: qW, height: qH, color: q.color }, userId),
    });
  }
  return {
    message: 'Created SWOT analysis with 4 quadrants (Strengths, Weaknesses, Opportunities, Threats).',
    actions: [{ tool: 'template:swot', description: 'Created SWOT analysis (4 quadrants)' }],
    operations: ops,
  };
}

// ─── Kanban Board ───
function buildKanban(userId: string, x = 50, y = 80): TemplateResult {
  const ops: PendingOperation[] = [];
  const colW = 220, colH = 400, gap = 20, titleH = 35;
  const columns = [
    { label: 'To Do', color: '#FEE2E2' },
    { label: 'In Progress', color: '#FEF3C7' },
    { label: 'Review', color: '#DBEAFE' },
    { label: 'Done', color: '#DCFCE7' },
  ];
  for (let i = 0; i < columns.length; i++) {
    const cx = x + i * (colW + gap);
    ops.push({
      type: 'create',
      object: makeObj({ type: ObjectType.TEXT_BOX, position: { x: cx, y }, width: colW, height: titleH, content: columns[i].label, color: '#1F2937', fontSize: 16 }, userId),
    });
    ops.push({
      type: 'create',
      object: makeObj({ type: ObjectType.RECTANGLE, position: { x: cx, y: y + titleH }, width: colW, height: colH, color: columns[i].color }, userId),
    });
  }
  return {
    message: 'Created Kanban board with 4 columns: To Do, In Progress, Review, Done.',
    actions: [{ tool: 'template:kanban', description: 'Created Kanban board (4 columns)' }],
    operations: ops,
  };
}

// ─── Brainstorm Grid ───
function buildBrainstorm(userId: string, topic?: string, x = 100, y = 100): TemplateResult {
  const ops: PendingOperation[] = [];
  const colors = ['#FEF3C7', '#FEE2E2', '#DCFCE7', '#DBEAFE', '#E9D5FF', '#F3F4F6'];
  const noteW = 150, noteH = 100, gap = 20;
  const cols = 3, rows = 2;

  // Title
  if (topic) {
    ops.push({
      type: 'create',
      object: makeObj({ type: ObjectType.TEXT_BOX, position: { x, y: y - 45 }, width: cols * (noteW + gap), height: 35, content: topic, color: '#1F2937', fontSize: 18 }, userId),
    });
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      ops.push({
        type: 'create',
        object: makeObj({
          type: ObjectType.STICKY_NOTE,
          position: { x: x + c * (noteW + gap), y: y + r * (noteH + gap) },
          width: noteW,
          height: noteH,
          content: '',
          color: colors[idx % colors.length],
        }, userId),
      });
    }
  }
  return {
    message: `Created brainstorm grid with 6 sticky notes${topic ? ` for "${topic}"` : ''}.`,
    actions: [{ tool: 'template:brainstorm', description: 'Created brainstorm grid (6 sticky notes)' }],
    operations: ops,
  };
}

// ─── Pros and Cons ───
function buildProsCons(userId: string, x = 100, y = 100): TemplateResult {
  const ops: PendingOperation[] = [];
  const colW = 250, colH = 300, gap = 30, titleH = 35;

  // Pros column
  ops.push({
    type: 'create',
    object: makeObj({ type: ObjectType.TEXT_BOX, position: { x, y }, width: colW, height: titleH, content: 'Pros', color: '#166534', fontSize: 18 }, userId),
  });
  ops.push({
    type: 'create',
    object: makeObj({ type: ObjectType.RECTANGLE, position: { x, y: y + titleH }, width: colW, height: colH, color: '#DCFCE7' }, userId),
  });

  // Cons column
  ops.push({
    type: 'create',
    object: makeObj({ type: ObjectType.TEXT_BOX, position: { x: x + colW + gap, y }, width: colW, height: titleH, content: 'Cons', color: '#991B1B', fontSize: 18 }, userId),
  });
  ops.push({
    type: 'create',
    object: makeObj({ type: ObjectType.RECTANGLE, position: { x: x + colW + gap, y: y + titleH }, width: colW, height: colH, color: '#FEE2E2' }, userId),
  });

  return {
    message: 'Created Pros and Cons comparison layout.',
    actions: [{ tool: 'template:proscons', description: 'Created Pros/Cons comparison' }],
    operations: ops,
  };
}

// ─── Timeline ───
function buildTimeline(userId: string, x = 50, y = 250): TemplateResult {
  const ops: PendingOperation[] = [];
  const milestones = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5'];
  const spacing = 180;
  const lineY = y;
  const dotR = 12;

  // Horizontal line (thin rect)
  ops.push({
    type: 'create',
    object: makeObj({ type: ObjectType.RECTANGLE, position: { x, y: lineY - 2 }, width: (milestones.length - 1) * spacing + 40, height: 4, color: '#6B7280' }, userId),
  });

  for (let i = 0; i < milestones.length; i++) {
    const mx = x + 20 + i * spacing;
    // Dot
    ops.push({
      type: 'create',
      object: makeObj({ type: ObjectType.CIRCLE, position: { x: mx - dotR, y: lineY - dotR }, width: dotR * 2, height: dotR * 2, color: '#3B82F6' }, userId),
    });
    // Label
    ops.push({
      type: 'create',
      object: makeObj({ type: ObjectType.TEXT_BOX, position: { x: mx - 40, y: lineY + 20 }, width: 80, height: 30, content: milestones[i], color: '#1F2937', fontSize: 14 }, userId),
    });
  }

  return {
    message: 'Created timeline with 5 milestones.',
    actions: [{ tool: 'template:timeline', description: 'Created timeline (5 milestones)' }],
    operations: ops,
  };
}

// ─── Eisenhower Matrix ───
function buildEisenhower(userId: string, x = 100, y = 100): TemplateResult {
  const ops: PendingOperation[] = [];
  const qW = 250, qH = 200, gap = 20, titleH = 35;
  const quadrants = [
    { label: 'Urgent & Important', color: '#FEE2E2', col: 0, row: 0 },
    { label: 'Not Urgent & Important', color: '#DBEAFE', col: 1, row: 0 },
    { label: 'Urgent & Not Important', color: '#FEF3C7', col: 0, row: 1 },
    { label: 'Not Urgent & Not Important', color: '#F3F4F6', col: 1, row: 1 },
  ];
  for (const q of quadrants) {
    const qx = x + q.col * (qW + gap);
    const qy = y + q.row * (qH + gap + titleH);
    ops.push({
      type: 'create',
      object: makeObj({ type: ObjectType.TEXT_BOX, position: { x: qx, y: qy }, width: qW, height: titleH, content: q.label, color: '#1F2937', fontSize: 16 }, userId),
    });
    ops.push({
      type: 'create',
      object: makeObj({ type: ObjectType.RECTANGLE, position: { x: qx, y: qy + titleH }, width: qW, height: qH, color: q.color }, userId),
    });
  }
  return {
    message: 'Created Eisenhower Matrix (Urgent/Important priority grid).',
    actions: [{ tool: 'template:eisenhower', description: 'Created Eisenhower Matrix (4 quadrants)' }],
    operations: ops,
  };
}

// ─── Pattern matching ───
interface TemplateMatch {
  pattern: RegExp;
  builder: (userId: string, topic?: string) => TemplateResult;
}

const TEMPLATE_MATCHERS: TemplateMatch[] = [
  { pattern: /\bswot\b/i, builder: (uid) => buildSWOT(uid) },
  { pattern: /\bkanban\b/i, builder: (uid) => buildKanban(uid) },
  { pattern: /\bpros?\s*(and|&|\/)\s*cons?\b/i, builder: (uid) => buildProsCons(uid) },
  { pattern: /\btimeline\b/i, builder: (uid) => buildTimeline(uid) },
  { pattern: /\beisenhower\b/i, builder: (uid) => buildEisenhower(uid) },
  {
    pattern: /\bbrain\s*storm/i,
    builder: (uid, topic) => buildBrainstorm(uid, topic),
  },
];

/**
 * Try to match the command to a pre-built template.
 * Returns null if no template matches — caller should fall back to the LLM.
 */
export function tryTemplateMatch(
  command: string,
  boardId: string,
  userId: string,
): { success: true; result: { message: string; boardId: string; actions: ToolAction[]; operations: PendingOperation[] } } | null {
  for (const { pattern, builder } of TEMPLATE_MATCHERS) {
    if (pattern.test(command)) {
      // Extract a topic for brainstorm: "brainstorm about X" → X
      let topic: string | undefined;
      const topicMatch = command.match(/brain\s*storm\s+(?:about\s+|on\s+|for\s+)?(.+)/i);
      if (topicMatch) topic = topicMatch[1].trim();

      const result = builder(userId, topic);
      return {
        success: true,
        result: { ...result, boardId },
      };
    }
  }
  return null;
}
