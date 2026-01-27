/**
 * Pilot Offscreen Document - WebLLM + Chrome AI Runtime
 * 
 * Responsibilities:
 * - Initialize and manage WebLLM engine
 * - Process inference requests from service worker
 * - Handle tool calling loop
 * - Fallback to Chrome Built-in AI when appropriate
 */

import * as webllm from '@anthropic/webllm';
import type { BrowserContext, Tool, ToolResult } from '../sdk/types';

// ============================================================================
// Configuration
// ============================================================================

// Recommended model for 12GB VRAM
const DEFAULT_MODEL = 'Llama-3.1-8B-Instruct-q4f16_1-MLC';

// Fallback for lower VRAM
const FALLBACK_MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

// ============================================================================
// State
// ============================================================================

interface OffscreenState {
  engine: webllm.MLCEngine | null;
  isInitializing: boolean;
  isReady: boolean;
  modelId: string;
  chromeAI: {
    promptSession: any;
    summarizer: any;
    translator: any;
  };
}

const state: OffscreenState = {
  engine: null,
  isInitializing: false,
  isReady: false,
  modelId: DEFAULT_MODEL,
  chromeAI: {
    promptSession: null,
    summarizer: null,
    translator: null,
  },
};

// ============================================================================
// WebLLM Initialization
// ============================================================================

async function initializeWebLLM(): Promise<void> {
  if (state.isInitializing || state.isReady) return;
  state.isInitializing = true;

  console.log('[Pilot/Offscreen] Initializing WebLLM...');

  try {
    // Check WebGPU availability
    if (!navigator.gpu) {
      throw new Error('WebGPU not available');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get WebGPU adapter');
    }

    // Check VRAM (if available)
    const device = await adapter.requestDevice();
    const limits = device.limits;
    console.log('[Pilot/Offscreen] WebGPU device limits:', {
      maxBufferSize: limits.maxBufferSize,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
    });

    // Initialize engine
    state.engine = await webllm.CreateMLCEngine(state.modelId, {
      initProgressCallback: (progress) => {
        console.log(`[Pilot/Offscreen] Model loading: ${progress.text}`);
        // Notify service worker of progress
        chrome.runtime.sendMessage({
          type: 'LLM_PROGRESS',
          payload: { progress: progress.progress, text: progress.text },
        });
      },
    });

    state.isReady = true;
    state.isInitializing = false;

    console.log('[Pilot/Offscreen] WebLLM ready with model:', state.modelId);

    // Notify service worker
    chrome.runtime.sendMessage({ type: 'LLM_READY' });

  } catch (error) {
    console.error('[Pilot/Offscreen] WebLLM initialization failed:', error);
    state.isInitializing = false;

    // Try fallback model
    if (state.modelId === DEFAULT_MODEL) {
      console.log('[Pilot/Offscreen] Trying fallback model...');
      state.modelId = FALLBACK_MODEL;
      await initializeWebLLM();
    } else {
      // Report error to service worker
      chrome.runtime.sendMessage({
        type: 'LLM_ERROR',
        payload: { error: String(error) },
      });
    }
  }
}

// ============================================================================
// Chrome Built-in AI Initialization
// ============================================================================

async function initializeChromeAI(): Promise<void> {
  // Check for Chrome AI APIs
  if ('ai' in window) {
    const ai = (window as any).ai;

    // Prompt API
    if (ai.languageModel) {
      try {
        const capabilities = await ai.languageModel.capabilities();
        if (capabilities.available === 'readily') {
          state.chromeAI.promptSession = await ai.languageModel.create();
          console.log('[Pilot/Offscreen] Chrome AI Prompt API ready');
        }
      } catch (e) {
        console.warn('[Pilot/Offscreen] Chrome AI Prompt API not available:', e);
      }
    }

    // Summarizer API
    if (ai.summarizer) {
      try {
        const capabilities = await ai.summarizer.capabilities();
        if (capabilities.available === 'readily') {
          state.chromeAI.summarizer = await ai.summarizer.create();
          console.log('[Pilot/Offscreen] Chrome AI Summarizer ready');
        }
      } catch (e) {
        console.warn('[Pilot/Offscreen] Chrome AI Summarizer not available:', e);
      }
    }

    // Translator API
    if (ai.translator) {
      try {
        const languagePair = { sourceLanguage: 'en', targetLanguage: 'es' };
        const capabilities = await ai.translator.capabilities();
        if (capabilities.available === 'readily') {
          // Translator is available but we create on-demand for specific pairs
          console.log('[Pilot/Offscreen] Chrome AI Translator available');
        }
      } catch (e) {
        console.warn('[Pilot/Offscreen] Chrome AI Translator not available:', e);
      }
    }
  }
}

// ============================================================================
// Inference
// ============================================================================

async function runInference(
  message: string,
  context: BrowserContext,
  tools: Tool[]
): Promise<{ text: string; toolCalls?: any[] }> {
  
  // Build system prompt with context
  const systemPrompt = buildSystemPrompt(context, tools);

  // Try WebLLM first
  if (state.isReady && state.engine) {
    return await runWebLLMInference(systemPrompt, message, tools);
  }

  // Fallback to Chrome AI
  if (state.chromeAI.promptSession) {
    return await runChromeAIInference(systemPrompt, message);
  }

  throw new Error('No AI backend available');
}

function buildSystemPrompt(context: BrowserContext, tools: Tool[]): string {
  const activeTab = context.activeTab;
  
  let prompt = `You are Pilot, a helpful browser assistant. You can see and interact with web pages.

## Current Context
`;

  if (activeTab) {
    prompt += `
**Active Tab**: ${activeTab.title}
**URL**: ${activeTab.url}
`;

    if (activeTab.dom?.mainContent) {
      // Truncate content to fit context window
      const content = activeTab.dom.mainContent.slice(0, 3000);
      prompt += `
**Page Content** (truncated):
${content}
`;
    }

    if (activeTab.dom?.headings?.length) {
      prompt += `
**Page Structure**:
${activeTab.dom.headings.map(h => `- ${h}`).join('\n')}
`;
    }
  }

  if (context.selection) {
    prompt += `
**User Selection**: "${context.selection}"
`;
  }

  if (context.tabs.length > 1) {
    prompt += `
**Other Open Tabs** (${context.tabs.length - 1}):
${context.tabs
  .filter(t => !t.isActive)
  .slice(0, 5)
  .map(t => `- ${t.title} (${t.url})`)
  .join('\n')}
`;
  }

  // Add tools
  if (tools.length > 0) {
    prompt += `
## Available Tools
You can use these tools by responding with a JSON tool call:

${tools.map(t => `
### ${t.name}
${t.description}
Parameters: ${JSON.stringify(t.parameters, null, 2)}
`).join('\n')}

To use a tool, respond with:
\`\`\`json
{"tool": "tool_name", "arguments": {...}}
\`\`\`
`;
  }

  prompt += `
## Guidelines
- Be concise and helpful
- Reference specific content from the page when relevant
- Use tools when they would help accomplish the user's goal
- If you can't help, explain why clearly
`;

  return prompt;
}

async function runWebLLMInference(
  systemPrompt: string,
  message: string,
  tools: Tool[]
): Promise<{ text: string; toolCalls?: any[] }> {
  
  const messages: webllm.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ];

  const completion = await state.engine!.chat.completions.create({
    messages,
    temperature: 0.7,
    max_tokens: 1024,
  });

  const response = completion.choices[0]?.message?.content || '';

  // Check for tool calls in response
  const toolCalls = parseToolCalls(response);

  return {
    text: response,
    toolCalls,
  };
}

async function runChromeAIInference(
  systemPrompt: string,
  message: string
): Promise<{ text: string }> {
  
  const prompt = `${systemPrompt}\n\nUser: ${message}\n\nAssistant:`;
  const response = await state.chromeAI.promptSession.prompt(prompt);

  return { text: response };
}

function parseToolCalls(response: string): any[] | undefined {
  // Look for JSON tool calls in the response
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) return undefined;

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (parsed.tool && parsed.arguments) {
      return [parsed];
    }
  } catch {
    // Not valid JSON
  }

  return undefined;
}

// ============================================================================
// Summarization (Chrome AI)
// ============================================================================

async function summarize(content: string): Promise<{ success: boolean; summary?: string; error?: string }> {
  if (!state.chromeAI.summarizer) {
    // Fallback to WebLLM
    if (state.isReady && state.engine) {
      const result = await runWebLLMInference(
        'You are a helpful assistant. Summarize the following content concisely.',
        `Please summarize this content:\n\n${content.slice(0, 5000)}`,
        []
      );
      return { success: true, summary: result.text };
    }
    return { success: false, error: 'No summarizer available' };
  }

  try {
    const summary = await state.chromeAI.summarizer.summarize(content);
    return { success: true, summary };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

async function handleMessage(message: any): Promise<any> {
  switch (message.type) {
    case 'INFERENCE_REQUEST':
      // Ensure initialized
      if (!state.isReady && !state.isInitializing) {
        await initializeWebLLM();
      }

      // Wait for initialization
      while (state.isInitializing) {
        await new Promise(r => setTimeout(r, 100));
      }

      try {
        const result = await runInference(
          message.payload.message,
          message.payload.context,
          message.payload.tools || []
        );

        // If there are tool calls, execute them and continue
        if (result.toolCalls && result.toolCalls.length > 0) {
          const toolResults = await executeToolCalls(result.toolCalls);
          // For now, return the original response + tool results
          // A full implementation would feed tool results back to the LLM
          return {
            text: result.text,
            toolResults,
          };
        }

        return result;
      } catch (error) {
        return { error: String(error) };
      }

    case 'SUMMARIZE':
      return await summarize(message.payload.content);

    case 'GET_STATUS':
      return {
        webllmReady: state.isReady,
        webllmModel: state.modelId,
        chromeAI: {
          prompt: !!state.chromeAI.promptSession,
          summarizer: !!state.chromeAI.summarizer,
        },
      };

    default:
      return { error: 'Unknown message type' };
  }
}

async function executeToolCalls(toolCalls: any[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of toolCalls) {
    // Send tool call to service worker for execution
    const result = await chrome.runtime.sendMessage({
      type: 'TOOL_CALL',
      payload: {
        name: call.tool,
        arguments: call.arguments,
      },
    });
    results.push(result);
  }

  return results;
}

// ============================================================================
// Initialization
// ============================================================================

async function initialize(): Promise<void> {
  console.log('[Pilot/Offscreen] Starting...');

  // Initialize Chrome AI first (faster)
  await initializeChromeAI();

  // Start WebLLM initialization (background)
  initializeWebLLM();
}

initialize();
