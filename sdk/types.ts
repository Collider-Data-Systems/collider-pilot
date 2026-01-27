/**
 * Pilot Type Definitions
 * 
 * Shared types used across all Pilot components:
 * - Service Worker
 * - Content Script
 * - Offscreen Document
 * - PiP Window
 * - SDK
 */

// ============================================================================
// Browser Context Types
// ============================================================================

export interface BrowserContext {
  tabs: TabContext[];
  activeTab: TabContext | null;
  recentHistory: HistoryItem[];
  relevantBookmarks: Bookmark[];
  selection: string | null;
}

export interface TabContext {
  id: number;
  url: string;
  title: string;
  isActive: boolean;
  dom: DOMSnapshot | null;
  scrollPosition: number;
  selection: string | null;
}

export interface DOMSnapshot {
  url: string;
  title: string;
  headings: string[];
  mainContent: string;
  links: LinkInfo[];
  forms: FormInfo[];
  interactiveElements: InteractiveElement[];
  timestamp: number;
}

export interface LinkInfo {
  text: string;
  href: string;
  isExternal: boolean;
}

export interface FormInfo {
  id: string;
  action: string;
  method: string;
  inputs: InputInfo[];
}

export interface InputInfo {
  name: string;
  type: string;
  placeholder: string;
  value: string;
}

export interface InteractiveElement {
  tag: string;
  text: string;
  selector: string;
}

export interface HistoryItem {
  url: string;
  title: string;
  lastVisit: number;
  visitCount: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageType =
  // Content Script -> Service Worker
  | 'DOM_SNAPSHOT'
  | 'SELECTION_CHANGED'
  // PiP -> Service Worker
  | 'GET_CONTEXT'
  | 'CHAT_MESSAGE'
  | 'EXECUTE_TOOL'
  // Service Worker -> Offscreen
  | 'INFERENCE_REQUEST'
  | 'SUMMARIZE'
  | 'GET_STATUS'
  // Offscreen -> Service Worker
  | 'LLM_READY'
  | 'LLM_PROGRESS'
  | 'LLM_ERROR'
  | 'TOOL_CALL'
  // Service Worker -> Content Script
  | 'GET_FULL_CONTENT'
  | 'SCROLL'
  | 'CLICK'
  | 'FILL_INPUT'
  | 'OPEN_PIP'
  | 'CLOSE_PIP'
  // Page -> Content Script (via SDK bridge)
  | 'PILOT_CONTEXT_UPDATE'
  | 'PILOT_REGISTER_TOOLS';

export interface Message {
  type: MessageType;
  payload?: any;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  handler?: (params: any) => Promise<any>;
  requiresPermission?: string[];
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: any;
  items?: JSONSchemaProperty;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
}

// ============================================================================
// SDK Types (for web apps integrating with Pilot)
// ============================================================================

export interface PilotSDK {
  /**
   * Check if Pilot extension is installed and active
   */
  isAvailable(): Promise<boolean>;

  /**
   * Register app-specific context with Pilot
   */
  setContext(context: AppContext): void;

  /**
   * Register app-specific tools that Pilot can invoke
   */
  registerTools(tools: Tool[]): void;

  /**
   * Send a message to Pilot
   */
  sendMessage(message: string): Promise<string>;

  /**
   * Listen for Pilot events
   */
  on(event: PilotEvent, callback: (data: any) => void): () => void;
}

export interface AppContext {
  /**
   * App name (shown in Pilot context)
   */
  name: string;

  /**
   * Current state/view description
   */
  state: string;

  /**
   * Structured data for AI context
   */
  data?: Record<string, any>;

  /**
   * Available actions the user can take
   */
  actions?: string[];
}

export type PilotEvent =
  | 'connected'
  | 'disconnected'
  | 'tool_invoked'
  | 'context_requested';

// ============================================================================
// llms.txt Protocol Types
// ============================================================================

export interface LlmsTxt {
  /**
   * Project/app name
   */
  name: string;

  /**
   * Short description
   */
  description: string;

  /**
   * Documentation sections
   */
  sections: LlmsTxtSection[];

  /**
   * Optional: specific files to read
   */
  files?: string[];
}

export interface LlmsTxtSection {
  title: string;
  content: string;
  links?: Array<{
    text: string;
    url: string;
  }>;
}

// ============================================================================
// Chrome AI Types (for type safety with experimental APIs)
// ============================================================================

export interface ChromeAI {
  languageModel?: {
    capabilities(): Promise<{ available: 'readily' | 'after-download' | 'no' }>;
    create(options?: LanguageModelOptions): Promise<LanguageModelSession>;
  };
  summarizer?: {
    capabilities(): Promise<{ available: 'readily' | 'after-download' | 'no' }>;
    create(options?: SummarizerOptions): Promise<SummarizerSession>;
  };
  translator?: {
    capabilities(): Promise<{ available: 'readily' | 'after-download' | 'no' }>;
    create(options: TranslatorOptions): Promise<TranslatorSession>;
  };
}

export interface LanguageModelOptions {
  systemPrompt?: string;
  temperature?: number;
  topK?: number;
}

export interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): ReadableStream<string>;
  destroy(): void;
}

export interface SummarizerOptions {
  type?: 'key-points' | 'tl;dr' | 'teaser' | 'headline';
  format?: 'plain-text' | 'markdown';
  length?: 'short' | 'medium' | 'long';
}

export interface SummarizerSession {
  summarize(input: string): Promise<string>;
  destroy(): void;
}

export interface TranslatorOptions {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslatorSession {
  translate(input: string): Promise<string>;
  destroy(): void;
}

// ============================================================================
// WebLLM Types (partial, for reference)
// ============================================================================

export interface WebLLMProgress {
  progress: number;
  text: string;
}

export interface WebLLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
