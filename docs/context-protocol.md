# Context Protocol

How web applications communicate context and capabilities to Pilot.

## Overview

Pilot can receive context from web applications in three ways:

1. **Automatic DOM Analysis** - Default, works on all sites
2. **SDK Integration** - Apps explicitly register context/tools
3. **llms.txt Discovery** - Apps serve structured context at `/llms.txt`

## 1. Automatic DOM Analysis

By default, Pilot's content script analyzes every page:

```typescript
interface DOMSnapshot {
  url: string;
  title: string;
  headings: string[]; // h1, h2, h3 text content
  mainContent: string; // Extracted body text (~10KB)
  links: LinkInfo[]; // Up to 50 links
  forms: FormInfo[]; // Up to 5 forms with inputs
  interactiveElements: []; // Buttons, clickable elements
  timestamp: number;
}
```

This provides basic context without any app modification.

## 2. SDK Integration

Apps can provide richer context using the Pilot SDK:

```typescript
// In your web app
import { createPilotBridge } from "@pilot/sdk";

const pilot = createPilotBridge();

// Register app context
pilot.setContext({
  name: "Task Manager",
  state: "Viewing project: Acme Corp",
  data: {
    currentProject: { id: "123", name: "Acme Corp" },
    openTasks: 5,
    completedToday: 3,
  },
  actions: ["Create new task", "Mark all as complete", "Export to CSV"],
});

// Register custom tools
pilot.registerTools([
  {
    name: "create_task",
    description: "Create a new task in the current project",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        dueDate: { type: "string", description: "ISO date string" },
      },
      required: ["title"],
    },
  },
]);

// Handle tool invocations
pilot.on("tool_invoked", async (data) => {
  if (data.name === "create_task") {
    const result = await myApp.createTask(data.arguments);
    return { success: true, taskId: result.id };
  }
});
```

### Context Updates

Keep context fresh as the user navigates:

```typescript
// React example
useEffect(() => {
  pilot.setContext({
    name: "My App",
    state: `Viewing ${currentView}`,
    data: currentData,
  });
}, [currentView, currentData]);
```

## 3. llms.txt Discovery

Apps can serve a structured markdown file at `/llms.txt` that Pilot fetches automatically.

### Format

```markdown
# App Name

> Short description of what the app does

## Features

- Feature 1: Description
- Feature 2: Description

## Current State

{{dynamic_state}}

## Available Actions

- action_name: What it does

## API Reference

- [Endpoint docs](/api/docs)
```

### Dynamic Content

llms.txt can include dynamic state via server-side rendering:

```markdown
## Current User

- Name: {{user.name}}
- Role: {{user.role}}
- Projects: {{user.projects.length}}

## Active Project

{{#if project}}

- Name: {{project.name}}
- Status: {{project.status}}
- Team: {{project.team.map(t => t.name).join(', ')}}
  {{/if}}
```

### Discovery Process

1. Content script checks for `<link rel="llms" href="/llms.txt">`
2. Falls back to fetching `/llms.txt` directly
3. Parses markdown structure into context

## Context Priority

When multiple context sources exist, Pilot merges them:

1. **SDK context** (highest priority) - Most specific, app-provided
2. **llms.txt** - Structured documentation
3. **DOM analysis** (lowest priority) - Generic fallback

## Tool Invocation Flow

```
User: "Create a task called 'Review PR' due tomorrow"
         │
         ▼
┌─────────────────────────────────────────┐
│           Pilot AI Engine               │
│  - Matches intent to 'create_task' tool │
│  - Extracts parameters from message     │
└─────────────────────────────────────────┘
         │
         ▼ Tool Call
┌─────────────────────────────────────────┐
│          Service Worker                 │
│  - Looks up tool in registered tools    │
│  - Forwards to appropriate handler      │
└─────────────────────────────────────────┘
         │
         ▼ Message to content script
┌─────────────────────────────────────────┐
│          Content Script                 │
│  - Forwards to page via postMessage     │
└─────────────────────────────────────────┘
         │
         ▼ postMessage
┌─────────────────────────────────────────┐
│          Page (SDK Bridge)              │
│  - Invokes registered tool handler      │
│  - Returns result                       │
└─────────────────────────────────────────┘
         │
         ▼ Result bubbles back up
┌─────────────────────────────────────────┐
│           Pilot AI Engine               │
│  - Incorporates result into response    │
│  - "Created task 'Review PR' (#456)"   │
└─────────────────────────────────────────┘
```

## Best Practices

### Context Design

1. **Be specific** - Include the current state, not just capabilities
2. **Keep it fresh** - Update context when app state changes
3. **Include identifiers** - Task IDs, project names help AI reference specifics
4. **List available actions** - What can the user do right now?

### Tool Design

1. **Clear descriptions** - AI relies on these to match user intent
2. **Typed parameters** - Use JSON Schema properly
3. **Validation** - Validate params before executing
4. **Return useful info** - IDs, confirmation messages, errors

### Security

1. **Validate origin** - Check message sources in handlers
2. **Sanitize inputs** - Don't trust tool parameters blindly
3. **Limit scope** - Only expose safe actions as tools
4. **Audit tool calls** - Log what Pilot invokes
