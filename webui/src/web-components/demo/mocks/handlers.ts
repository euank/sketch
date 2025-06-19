import { http, HttpResponse, delay } from "msw";
import { initialState, initialMessages } from "../../../fixtures/dummy";
import { AgentMessage, State } from "../../../types";

// Mock state updates for SSE simulation
const EMPTY_CONVERSATION =
  new URL(window.location.href).searchParams.get("emptyConversation") === "1";
const ADD_NEW_MESSAGES =
  new URL(window.location.href).searchParams.get("addNewMessages") === "1";

const messages = EMPTY_CONVERSATION ? [] : [...initialMessages];

// Initialize state with correct message_count
let currentState = { 
  ...initialState, 
  message_count: messages.length 
};

// Text encoder for SSE messages
const encoder = new TextEncoder();

// Helper function to create SSE formatted messages
function formatSSE(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const handlers = [
  // SSE stream endpoint
  http.get("*/stream", async ({ request }) => {
    const url = new URL(request.url);
    const fromIndex = parseInt(url.searchParams.get("from") || "0");

    // Create a readable stream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        // Send initial state update
        controller.enqueue(encoder.encode(formatSSE("state", currentState)));

        // Send any existing messages that are newer than the fromIndex
        const newMessages = messages.filter((msg) => msg.idx >= fromIndex);
        for (const message of newMessages) {
          controller.enqueue(encoder.encode(formatSSE("message", message)));
        }

        // Simulate heartbeats and new messages
        let heartbeatInterval;
        let messageInterval;

        // Send heartbeats every 30 seconds
        heartbeatInterval = setInterval(() => {
          controller.enqueue(
            encoder.encode(
              formatSSE("heartbeat", { timestamp: new Date().toISOString() }),
            ),
          );
        }, 30000);

        // Add new messages if enabled
        if (ADD_NEW_MESSAGES) {
          messageInterval = setInterval(() => {
            const newMessage = {
              type: "agent" as const,
              end_of_turn: false,
              content: "Here's a new message via SSE",
              timestamp: new Date().toISOString(),
              conversation_id: "37s-g6xg",
              usage: {
                input_tokens: 5,
                cache_creation_input_tokens: 250,
                cache_read_input_tokens: 4017,
                output_tokens: 92,
                cost_usd: 0.0035376,
              },
              start_time: new Date(Date.now() - 2000).toISOString(),
              end_time: new Date().toISOString(),
              elapsed: 2075193375,
              turnDuration: 28393844125,
              idx: messages.length,
            };

            // Add to our messages array
            messages.push(newMessage);

            // Update the state
            currentState = {
              ...currentState,
              message_count: messages.length,
            };

            // Send the message and updated state through SSE
            controller.enqueue(
              encoder.encode(formatSSE("message", newMessage)),
            );
            controller.enqueue(
              encoder.encode(formatSSE("state", currentState)),
            );
          }, 2000); // Add a new message every 2 seconds
        }

        // Clean up on connection close
        request.signal.addEventListener("abort", () => {
          clearInterval(heartbeatInterval);
          if (messageInterval) clearInterval(messageInterval);
        });
      },
    });

    return new HttpResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }),

  // State endpoint (non-streaming version for initial state)
  http.get("*/state", () => {
    return HttpResponse.json(currentState);
  }),

  // Messages endpoint
  http.get("*/messages", ({ request }) => {
    const url = new URL(request.url);
    const startIndex = parseInt(url.searchParams.get("start") || "0");

    return HttpResponse.json(messages.slice(startIndex));
  }),

  // Chat endpoint for sending messages
  http.post("*/chat", async ({ request }) => {
    const body = await request.json();

    // Add a user message
    messages.push({
      type: "user" as const,
      end_of_turn: true,
      content:
        typeof body === "object" && body !== null
          ? String(body.message || "")
          : "",
      timestamp: new Date().toISOString(),
      conversation_id: "37s-g6xg",
      idx: messages.length,
    });

    // Update state
    currentState = {
      ...currentState,
      message_count: messages.length,
    };

    return new HttpResponse(null, { status: 204 });
  }),

  // Cancel endpoint
  http.post("*/cancel", () => {
    return new HttpResponse(null, { status: 204 });
  }),
];
