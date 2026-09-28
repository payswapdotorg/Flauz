/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- canned vendor wire payloads (M2 fixture data).
 *
 * Realistic, FROZEN replays of the three wire families: happy streams (text,
 * tool calls, usage), error statuses (401/429/500/529/404/400) and
 * deliberately MALFORMED frames. These are FIXTURES: they pin the wire
 * shapes the adapters speak. They are not, and must never be presented as,
 * live-provider captures (see INTEGRATION-GAPS in the delivery REPORT).
 *
 * No credential-shaped literal is stored here or anywhere in this repo: the
 * mock key material below is assembled at runtime from inert fragments and
 * exists ONLY inside the test process + the Authorization header of a
 * loopback request.
 */

/** Wraps payloads as SSE data frames (each terminated by a blank line). */
export function sseFrames(...payloads: readonly string[]): string[] {
	return payloads.map(payload => `data: ${payload}\n\n`);
}

/** Wraps a payload as a named SSE event. */
export function sseEvent(event: string, payload: string): string {
	return `event: ${event}\ndata: ${payload}\n\n`;
}

/** The runtime-assembled mock key (no secret-shaped literal in source). */
export function mockApiKey(): string {
	return ['flauz', 'fixture', 'key'].join('-');
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat-completions
// ---------------------------------------------------------------------------

export const OPENAI_CHAT_PATH = '/chat/completions';
export const OPENAI_MODELS_PATH = '/models';

/** Happy stream: text, one tool call accumulated across three fragments, finish, usage. */
export const OPENAI_HAPPY_TEXT_AND_TOOL: readonly string[] = [
	...sseFrames(
		'{"id":"chatcmpl-fx1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}',
		'{"id":"chatcmpl-fx1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" from"}}]}',
		'{"id":"chatcmpl-fx1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" the fixture"}}]}',
		'{"id":"chatcmpl-fx1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_fx_1","type":"function","function":{"name":"flauz_terminal","arguments":""}}]}}]}',
		'{"id":"chatcmpl-fx1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\":"}}]}}]}',
		'{"id":"chatcmpl-fx1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls -la\\"}"}}]}}]}',
		'{"id":"chatcmpl-fx1","object":"chat.completion.chunk","choices":[{"index":0,"finish_reason":"tool_calls"}]}',
		'{"id":"chatcmpl-fx1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":25,"completion_tokens":9}}',
	),
	'data: [DONE]\n\n',
];

/** Plain text-only stream that stops with finish_reason stop. */
export const OPENAI_HAPPY_TEXT_ONLY: readonly string[] = [
	...sseFrames(
		'{"id":"chatcmpl-fx2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Plain "}}]}',
		'{"id":"chatcmpl-fx2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"answer."}}]}',
		'{"id":"chatcmpl-fx2","object":"chat.completion.chunk","choices":[{"index":0,"finish_reason":"stop"}]}',
		'{"id":"chatcmpl-fx2","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":3}}',
	),
	'data: [DONE]\n\n',
];

/** Malformed: an SSE frame whose data is not JSON. */
export const OPENAI_MALFORMED_JSON_FRAME: readonly string[] = sseFrames('{"choices":[{"delta":{"content":"ok"}}]}', '{definitely-not-json');

export const OPENAI_ERROR_401 = '{"error":{"message":"Incorrect API key provided: flauz-fixture-key. You can find your API key at https://api.example.invalid.","type":"invalid_request_error","code":"invalid_api_key"}}';
export const OPENAI_ERROR_429 = '{"error":{"message":"Rate limit reached for requests","type":"requests","code":"rate_limit_exceeded"}}';
export const OPENAI_ERROR_500 = '{"error":{"message":"The server had an error while processing your request","type":"server_error"}}';
export const OPENAI_ERROR_400_CONTEXT = '{"error":{"message":"This model\'s maximum context length is 8192 tokens. However, you requested 9211 tokens in the messages. Please reduce the length of the messages.","type":"invalid_request_error","code":"context_length_exceeded"}}';
export const OPENAI_ERROR_404 = '{"error":{"message":"The model \'nope-model\' does not exist","type":"invalid_request_error","code":"model_not_found"}}';
export const OPENAI_ERROR_400_BAD = '{"error":{"message":"Invalid value for max_tokens","type":"invalid_request_error"}}';

// ---------------------------------------------------------------------------
// Anthropic-compatible messages
// ---------------------------------------------------------------------------

export const ANTHROPIC_CHAT_PATH = '/v1/messages';
export const ANTHROPIC_MODELS_PATH = '/v1/models';

/** Happy stream: text block + tool_use block assembled from input_json_delta fragments. */
export const ANTHROPIC_HAPPY_TEXT_AND_TOOL: readonly string[] = [
	sseEvent('message_start', '{"type":"message_start","message":{"id":"msg_fx_1","usage":{"input_tokens":31,"output_tokens":1}}}'),
	sseEvent('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}'),
	sseEvent('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Working "}}'),
	sseEvent('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"on it."}}'),
	sseEvent('content_block_stop', '{"type":"content_block_stop","index":0}'),
	sseEvent('content_block_start', '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_fx_1","name":"flauz_terminal"}}'),
	sseEvent('content_block_delta', '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":"}}'),
	sseEvent('content_block_delta', '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"pwd\\"}"}}'),
	sseEvent('content_block_stop', '{"type":"content_block_stop","index":1}'),
	sseEvent('message_delta', '{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":17}}'),
	sseEvent('message_stop', '{"type":"message_stop"}'),
];

/** Text-only stream ending with end_turn. */
export const ANTHROPIC_HAPPY_TEXT_ONLY: readonly string[] = [
	sseEvent('message_start', '{"type":"message_start","message":{"id":"msg_fx_2","usage":{"input_tokens":19,"output_tokens":1}}}'),
	sseEvent('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}'),
	sseEvent('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Local "}}'),
	sseEvent('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"reply."}}'),
	sseEvent('content_block_stop', '{"type":"content_block_stop","index":0}'),
	sseEvent('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":6}}'),
	sseEvent('message_stop', '{"type":"message_stop"}'),
	sseEvent('ping', '{"type":"ping"}'),
];

/** In-stream error event (rate limit) after some text. */
export const ANTHROPIC_STREAM_ERROR_RATE_LIMIT: readonly string[] = [
	sseEvent('message_start', '{"type":"message_start","message":{"id":"msg_fx_3","usage":{"input_tokens":10,"output_tokens":1}}}'),
	sseEvent('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}'),
	sseEvent('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}'),
	sseEvent('error', '{"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your per-minute rate limit"}}'),
];

/** Malformed: an event frame whose data is not JSON. */
export const ANTHROPIC_MALFORMED_JSON_FRAME: readonly string[] = [
	sseEvent('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}'),
	'event: content_block_delta\ndata: {not-json-at-all\n\n',
];

export const ANTHROPIC_ERROR_401 = '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
export const ANTHROPIC_ERROR_429 = '{"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your per-minute rate limit"}}';
export const ANTHROPIC_ERROR_529 = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
export const ANTHROPIC_ERROR_400_CONTEXT = '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 210000 tokens > 200000 maximum"}}';
export const ANTHROPIC_ERROR_404 = '{"type":"error","error":{"type":"not_found_error","message":"model: nope-model"}}';
export const ANTHROPIC_ERROR_400_BAD = '{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: field required"}}';

// ---------------------------------------------------------------------------
// Ollama-style local chat
// ---------------------------------------------------------------------------

export const OLLAMA_CHAT_PATH = '/api/chat';
export const OLLAMA_TAGS_PATH = '/api/tags';

/** Happy text stream with usage on the final line. */
export const OLLAMA_HAPPY_TEXT: readonly string[] = [
	'{"model":"flauz-fixture-local","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":""},"done":false}\n',
	'{"model":"flauz-fixture-local","created_at":"2026-01-01T00:00:01Z","message":{"role":"assistant","content":"Local "},"done":false}\n',
	'{"model":"flauz-fixture-local","created_at":"2026-01-01T00:00:02Z","message":{"role":"assistant","content":"model answer."},"done":false}\n',
	'{"model":"flauz-fixture-local","created_at":"2026-01-01T00:00:03Z","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","total_duration":1234567,"prompt_eval_count":12,"eval_count":5}\n',
];

/** Tool-call stream: tool_calls arrive as complete objects in one chunk. */
export const OLLAMA_HAPPY_TOOL: readonly string[] = [
	'{"model":"flauz-fixture-local","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":""},"done":false}\n',
	'{"model":"flauz-fixture-local","created_at":"2026-01-01T00:00:01Z","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"flauz_terminal","arguments":{"command":"pwd"}}}]},"done":false}\n',
	'{"model":"flauz-fixture-local","created_at":"2026-01-01T00:00:02Z","message":{"role":"assistant","content":"Running it."},"done":false}\n',
	'{"model":"flauz-fixture-local","created_at":"2026-01-01T00:00:03Z","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":14,"eval_count":6}\n',
];

/** Malformed: one NDJSON line that is not JSON. */
export const OLLAMA_MALFORMED_LINE: readonly string[] = [
	'{"model":"flauz-fixture-local","message":{"role":"assistant","content":"start"},"done":false}\n',
	'{oops not json}\n',
];

export const OLLAMA_ERROR_404 = '{"error":"model \\"nope-model\\" not found, try pulling it first"}';
export const OLLAMA_ERROR_500 = '{"error":"boom: fixture internal failure"}';
