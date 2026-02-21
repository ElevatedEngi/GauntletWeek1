// Core types for the whiteboard application

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
  content: string; // For text content
  color: string;
  userId: string;
  createdAt: number;
  updatedAt: number;

  // Connector-specific fields (only present when type === CONNECTOR)
  sourceObjectId?: string;
  targetObjectId?: string;
  connectorStyle?: 'line' | 'arrow';

  // Text box specific (only present when type === TEXT_BOX)
  fontSize?: number;

  // Frame specific (only present when type === FRAME)
  childObjectIds?: string[];
  frameLabel?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: number;
}

export interface Board {
  id: string;
  name: string;
  ownerId: string;
  objects: BoardObject[];
  createdAt: number;
  updatedAt: number;
}

export interface Cursor {
  userId: string;
  userName: string;
  position: Position;
  color: string;
}

export interface PresenceUser {
  userId: string;
  userName: string;
  email: string;
  status: 'online' | 'offline';
  lastSeen: number;
}

// WebSocket Events
export interface WebSocketEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface CursorMoveEvent extends WebSocketEvent {
  type: 'cursor:move';
  payload: {
    userId: string;
    userName: string;
    position: Position;
    color: string;
  };
}

export interface ObjectUpdateEvent extends WebSocketEvent {
  type: 'object:update';
  payload: {
    action: 'create' | 'update' | 'delete';
    object: BoardObject;
  };
}

export interface PresenceEvent extends WebSocketEvent {
  type: 'presence:join' | 'presence:leave';
  payload: PresenceUser;
}

// API Request/Response types
export interface LoginRequest {
  token: string;
  provider: 'google';
}

export interface CreateBoardRequest {
  name: string;
}

export interface CreateObjectRequest {
  type: ObjectType;
  position: Position;
  width: number;
  height: number;
  content?: string;
  color?: string;
}

export interface UpdateObjectRequest {
  position?: Position;
  width?: number;
  height?: number;
  content?: string;
  color?: string;
  rotation?: number;
}

export interface AICommandRequest {
  command: string;
  boardId: string;
}

export interface AIToolAction {
  tool: string;
  description: string;
  objectId?: string;
}

export interface AICommandResponse {
  success: boolean;
  result?: {
    message: string;
    boardId: string;
    actions: AIToolAction[];
  };
  error?: string;
  fallback?: string;
}

// Store state
export interface AppState {
  user: User | null;
  boards: Board[];
  currentBoard: Board | null;
  objects: Map<string, BoardObject>;
  cursors: Map<string, Cursor>;
  presenceUsers: Map<string, PresenceUser>;
  isConnected: boolean;
  isLoading: boolean;
}
