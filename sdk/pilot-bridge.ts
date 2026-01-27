/**
 * Pilot Bridge - Page ↔ Extension Communication SDK
 * 
 * This SDK allows web applications to integrate with Pilot:
 * - Register app-specific context
 * - Expose custom tools
 * - Communicate with the AI assistant
 * 
 * Usage:
 * ```typescript
 * import { createPilotBridge } from '@pilot/sdk';
 * 
 * const pilot = createPilotBridge();
 * 
 * // Check if Pilot is available
 * if (await pilot.isAvailable()) {
 *   // Register app context
 *   pilot.setContext({
 *     name: 'My App',
 *     state: 'Editing document',
 *     data: { documentId: '123', wordCount: 500 }
 *   });
 * 
 *   // Register custom tools
 *   pilot.registerTools([
 *     {
 *       name: 'create_document',
 *       description: 'Create a new document',
 *       parameters: {
 *         type: 'object',
 *         properties: {
 *           title: { type: 'string' }
 *         },
 *         required: ['title']
 *       }
 *     }
 *   ]);
 * }
 * ```
 */

import type { PilotSDK, AppContext, Tool, PilotEvent } from './types';

// Communication happens via window.postMessage
// Content script listens and forwards to service worker

const PILOT_NAMESPACE = 'pilot';
const RESPONSE_TIMEOUT = 30000;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export function createPilotBridge(): PilotSDK {
  const pendingRequests = new Map<string, PendingRequest>();
  const eventListeners = new Map<PilotEvent, Set<(data: any) => void>>();

  let messageId = 0;
  let isListening = false;

  function generateId(): string {
    return `${PILOT_NAMESPACE}-${Date.now()}-${++messageId}`;
  }

  function startListening(): void {
    if (isListening) return;
    isListening = true;

    window.addEventListener('message', (event) => {
      // Only accept messages from our window
      if (event.source !== window) return;

      const data = event.data;
      if (!data || data.namespace !== PILOT_NAMESPACE) return;

      // Handle response to a request
      if (data.responseId && pendingRequests.has(data.responseId)) {
        const pending = pendingRequests.get(data.responseId)!;
        clearTimeout(pending.timeout);
        pendingRequests.delete(data.responseId);

        if (data.error) {
          pending.reject(new Error(data.error));
        } else {
          pending.resolve(data.result);
        }
        return;
      }

      // Handle events from Pilot
      if (data.event) {
        const listeners = eventListeners.get(data.event);
        if (listeners) {
          listeners.forEach(cb => cb(data.payload));
        }
      }
    });
  }

  function sendRequest<T>(type: string, payload?: any): Promise<T> {
    startListening();

    return new Promise((resolve, reject) => {
      const id = generateId();

      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Pilot request timeout'));
      }, RESPONSE_TIMEOUT);

      pendingRequests.set(id, { resolve, reject, timeout });

      window.postMessage({
        namespace: PILOT_NAMESPACE,
        id,
        type,
        payload,
      }, '*');
    });
  }

  function sendNotification(type: string, payload?: any): void {
    window.postMessage({
      namespace: PILOT_NAMESPACE,
      type,
      payload,
    }, '*');
  }

  const sdk: PilotSDK = {
    async isAvailable(): Promise<boolean> {
      try {
        const result = await sendRequest<{ available: boolean }>('PILOT_PING');
        return result.available === true;
      } catch {
        return false;
      }
    },

    setContext(context: AppContext): void {
      sendNotification('PILOT_CONTEXT_UPDATE', context);
    },

    registerTools(tools: Tool[]): void {
      sendNotification('PILOT_REGISTER_TOOLS', { tools });
    },

    async sendMessage(message: string): Promise<string> {
      const result = await sendRequest<{ text: string }>('PILOT_MESSAGE', { message });
      return result.text;
    },

    on(event: PilotEvent, callback: (data: any) => void): () => void {
      startListening();

      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
      }
      eventListeners.get(event)!.add(callback);

      // Return unsubscribe function
      return () => {
        eventListeners.get(event)?.delete(callback);
      };
    },
  };

  return sdk;
}

// Auto-initialize if in browser context
declare global {
  interface Window {
    pilot?: PilotSDK;
  }
}

if (typeof window !== 'undefined') {
  window.pilot = createPilotBridge();
}

export default createPilotBridge;
