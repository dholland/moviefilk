import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElevenLabsRealtimeTranscriber, {
	interpretScribeRealtimeServerMessage,
} from "./elevenlabs-realtime-stt.ts";

describe("interpretScribeRealtimeServerMessage", () => {
	it("maps partial_transcript to interim", () => {
		expect(
			interpretScribeRealtimeServerMessage({
				message_type: "partial_transcript",
				text: "hello",
			}),
		).toEqual({ kind: "interim", text: "hello" });
	});

	it("maps committed_transcript to utterance", () => {
		expect(
			interpretScribeRealtimeServerMessage({
				message_type: "committed_transcript",
				text: "hello world",
			}),
		).toEqual({ kind: "utterance", text: "hello world" });
	});

	it("maps committed_transcript_with_timestamps to utterance", () => {
		expect(
			interpretScribeRealtimeServerMessage({
				message_type: "committed_transcript_with_timestamps",
				text: "done",
				words: [],
			}),
		).toEqual({ kind: "utterance", text: "done" });
	});

	it("ignores session_started", () => {
		expect(
			interpretScribeRealtimeServerMessage({
				message_type: "session_started",
				session_id: "s1",
				config: {},
			}),
		).toEqual({ kind: "noop" });
	});

	it("maps auth_error to error", () => {
		expect(
			interpretScribeRealtimeServerMessage({
				message_type: "auth_error",
				error: "bad token",
			}),
		).toEqual({ kind: "error", message: "bad token" });
	});

	it("maps error to error kind", () => {
		expect(
			interpretScribeRealtimeServerMessage({
				message_type: "error",
				error: "upstream failure",
			}),
		).toEqual({ kind: "error", message: "upstream failure" });
	});

	it("returns noop for empty partial text", () => {
		expect(
			interpretScribeRealtimeServerMessage({
				message_type: "partial_transcript",
				text: "",
			}),
		).toEqual({ kind: "noop" });
	});

	it("returns noop for malformed payloads", () => {
		expect(interpretScribeRealtimeServerMessage(null)).toEqual({
			kind: "noop",
		});
		expect(interpretScribeRealtimeServerMessage("x")).toEqual({ kind: "noop" });
	});
});

describe("ElevenLabsRealtimeTranscriber", () => {
	const originalWebSocket = globalThis.WebSocket;

	beforeEach(() => {
		const webSocketConstants = {
			CONNECTING: 0,
			OPEN: 1,
			CLOSING: 2,
			CLOSED: 3,
		} as unknown as typeof WebSocket;
		globalThis.WebSocket = webSocketConstants;
	});

	afterEach(() => {
		globalThis.WebSocket = originalWebSocket;
		vi.restoreAllMocks();
	});

	it("invokes onInterim then onUtterance when the mock socket receives scribe messages", async () => {
		const interim: string[] = [];
		const utterances: string[] = [];

		type ListenerType = (event: MessageEvent) => void;
		let openListener: (() => void) | null = null;
		let messageListener: ListenerType | null = null;
		let readyState = 0;
		const sent: string[] = [];

		const mockSocket = {
			get readyState() {
				return readyState;
			},
			addEventListener(
				type: string,
				listener: EventListenerOrEventListenerObject,
			) {
				const fn =
					typeof listener === "function"
						? listener
						: (listener as EventListenerObject).handleEvent.bind(listener);
				if (type === "open") {
					openListener = fn as () => void;
				}
				if (type === "message") {
					messageListener = fn as ListenerType;
				}
			},
			send(data: string) {
				sent.push(data);
			},
			close() {
				readyState = 3;
			},
		};

		const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.includes("single-use-token")) {
				return new Response(JSON.stringify({ token: "test-token" }), {
					status: 200,
				});
			}
			return new Response("not found", { status: 404 });
		});

		const transcriber = new ElevenLabsRealtimeTranscriber({
			apiKey: "test-key",
			fetchImpl: mockFetch as typeof fetch,
			createWebSocket: () => {
				readyState = 0;
				queueMicrotask(() => {
					readyState = 1;
					openListener?.();
				});
				return mockSocket as unknown as WebSocket;
			},
		});

		const session = transcriber.createSession({
			onInterim: (text) => interim.push(text),
			onUtterance: (text) => utterances.push(text),
		});

		await vi.waitFor(() => expect(openListener).not.toBeNull());
		await vi.waitFor(() => readyState === 1);

		const pcm = new ArrayBuffer(4);
		session.feed(pcm);
		await vi.waitFor(() => sent.length > 0);
		expect(sent.length).toBe(1);
		const firstOutbound = sent[0];
		if (firstOutbound === undefined) {
			throw new Error("expected one outbound scribe message");
		}
		const outbound: unknown = JSON.parse(firstOutbound);
		expect(outbound).toMatchObject({
			message_type: "input_audio_chunk",
			commit: false,
			sample_rate: 16_000,
		});

		messageListener?.({
			data: JSON.stringify({
				message_type: "partial_transcript",
				text: "hi",
			}),
		} as MessageEvent);

		messageListener?.({
			data: JSON.stringify({
				message_type: "committed_transcript",
				text: "hi there",
			}),
		} as MessageEvent);

		expect(interim).toEqual(["hi"]);
		expect(utterances).toEqual(["hi there"]);

		session.close();
		session.close();
		expect(() => session.close()).not.toThrow();
	});

	it("does not throw when close is called before the socket connects", async () => {
		let openListener: (() => void) | null = null;
		const mockSocket = {
			readyState: 0,
			addEventListener(
				type: string,
				listener: EventListenerOrEventListenerObject,
			) {
				const fn =
					typeof listener === "function"
						? listener
						: (listener as EventListenerObject).handleEvent.bind(listener);
				if (type === "open") {
					openListener = fn as () => void;
				}
			},
			send: vi.fn(),
			close: vi.fn(),
		};

		const mockFetch = vi.fn(async () => {
			return new Response(JSON.stringify({ token: "tok" }), { status: 200 });
		});

		const transcriber = new ElevenLabsRealtimeTranscriber({
			apiKey: "k",
			fetchImpl: mockFetch as typeof fetch,
			createWebSocket: () => mockSocket as unknown as WebSocket,
		});

		const session = transcriber.createSession({});
		session.close();
		await new Promise((resolve) => queueMicrotask(resolve));
		openListener?.();
		expect(mockSocket.send).not.toHaveBeenCalled();
	});

	it("delivers error frames to the message handler without throwing", async () => {
		let messageListener: ((event: MessageEvent) => void) | null = null;
		let openListener: (() => void) | null = null;
		let readyState = 0;

		const mockSocket = {
			get readyState() {
				return readyState;
			},
			addEventListener(
				type: string,
				listener: EventListenerOrEventListenerObject,
			) {
				const fn =
					typeof listener === "function"
						? listener
						: (listener as EventListenerObject).handleEvent.bind(listener);
				if (type === "open") {
					openListener = fn as () => void;
				}
				if (type === "message") {
					messageListener = fn as (event: MessageEvent) => void;
				}
			},
			send: vi.fn(),
			close: vi.fn(),
		};

		const mockFetch = vi.fn(async () => {
			return new Response(JSON.stringify({ token: "tok" }), { status: 200 });
		});

		const transcriber = new ElevenLabsRealtimeTranscriber({
			apiKey: "k",
			fetchImpl: mockFetch as typeof fetch,
			createWebSocket: () => {
				queueMicrotask(() => {
					readyState = 1;
					openListener?.();
				});
				return mockSocket as unknown as WebSocket;
			},
		});

		const session = transcriber.createSession({});
		await vi.waitFor(() => expect(messageListener).not.toBeNull());
		if (messageListener === null) {
			throw new Error("expected message listener");
		}
		const errorPayload = JSON.stringify({
			message_type: "error",
			error: "bad",
		});
		expect(() =>
			messageListener(new MessageEvent("message", { data: errorPayload })),
		).not.toThrow();
		session.close();
	});
});
