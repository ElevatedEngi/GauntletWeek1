// Shared types (subset from @whiteboard/shared-types for Cloud Functions)

export enum ObjectType {
  STICKY_NOTE = 'sticky_note',
  RECTANGLE = 'rectangle',
  CIRCLE = 'circle',
  LINE = 'line',
  ARROW = 'arrow',
  CONNECTOR = 'connector',
  TEXT_BOX = 'text_box',
  FRAME = 'frame',
}

export interface Position {
  x: number;
  y: number;
}

export interface BoardObject {
  id: string;
  type: ObjectType;
  position: Position;
  width: number;
  height: number;
  rotation: number;
  content: string;
  color: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  sourceObjectId?: string;
  targetObjectId?: string;
  connectorStyle?: 'line' | 'arrow';
  fontSize?: number;
  childObjectIds?: string[];
  frameLabel?: string;
}
