import { pathToFileURL } from "node:url";
import { Agent, type AgentMessage, type AgentOptions, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Context, Message, Model } from "@earendil-works/pi-ai";
import { createAnthropicCompatibleRuntime } from "../../src/core/anthropic-compatible-runtime.ts";

const DEFAULT_PROMPT = "请用一句中文说明：Pi 为什么要区分保存的记录和模型上下文？";

export interface UiNoticeMessage {
	role: "notice";
	text: string;
	timestamp: number;
}

// Pi 允许宿主扩展 AgentMessage；notice 留给界面显示，不能直接交给模型协议。
declare module "@earendil-works/pi-agent-core" {
	interface CustomAgentMessages {
		notice: UiNoticeMessage;
	}
}

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface BoundaryTrace {
	transformInput: AgentMessage[];
	transformOutput: AgentMessage[];
	convertInput: AgentMessage[];
	convertedMessages: Message[];
	sentMessages: Message[];
}

export interface BoundaryRuntime {
	agent: Agent;
	trace: BoundaryTrace;
}

export interface BoundaryRuntimeOptions {
	model: Model<Api>;
	streamFn: StreamFn;
	getApiKey?: AgentOptions["getApiKey"];
	initialMessages?: AgentMessage[];
	output?: LessonOutput;
}

export interface BoundaryObservation {
	trace: BoundaryTrace;
	transcript: AgentMessage[];
	finalText: string;
	hasRuntimeError: boolean;
}

export interface RunCodeOptions {
	runtime?: BoundaryRuntime;
	prompt?: string;
	output?: LessonOutput;
}

const consoleOutput: LessonOutput = { writeLine: (text) => console.log(text) };

function writeStep(output: LessonOutput | undefined, step: number, text: string): void {
	output?.writeLine(`[步骤 ${step}/4] ${text}`);
}

function describeMessages(messages: ReadonlyArray<AgentMessage | Message>): string {
	return (
		messages.map((message) => (message.role === "notice" ? "界面提示（notice）" : message.role)).join(" -> ") || "(空)"
	);
}

function createUserMessage(text: string, timestamp: number): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp };
}

function createAssistantMessage(text: string, timestamp: number): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "learn-pi-history",
		model: "teaching-history",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

export function createUiNotice(text: string, timestamp: number): UiNoticeMessage {
	return { role: "notice", text, timestamp };
}

function createInitialTranscript(): AgentMessage[] {
	return [
		createUserMessage("旧问题：解释上一版方案。", 1),
		createAssistantMessage("旧回复：已经解释。", 2),
		createUiNotice("界面提示：已切换到本课演示。", 3),
	];
}

// 第一层只选择本轮要看的 Agent 记录；slice 返回新数组，不删除 Agent 保存的 transcript。
export function selectRequestWindow(messages: AgentMessage[]): AgentMessage[] {
	return messages.slice(-2);
}

function isLlmMessage(message: AgentMessage): message is Message {
	return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

// 第二层只保留模型协议认识的三种角色；UI-only notice 在这里被挡在请求之外。
export function convertMessagesForModel(messages: AgentMessage[]): Message[] {
	return messages.filter(isLlmMessage);
}

function textFromFinalAssistant(messages: AgentMessage[]): string {
	const message = [...messages].reverse().find((item) => item.role === "assistant");
	if (message?.role !== "assistant") return "";
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

/**
 * 同一个 Agent 装配同时用于真实模型和离线 faux Provider。
 * trace 记录的是 Pi 交给 streamFn 的 Context.messages，因此能观察实际模型边界。
 */
export function createBoundaryRuntime(options: BoundaryRuntimeOptions): BoundaryRuntime {
	const trace: BoundaryTrace = {
		transformInput: [],
		transformOutput: [],
		convertInput: [],
		convertedMessages: [],
		sentMessages: [],
	};
	const agent = new Agent({
		initialState: {
			systemPrompt: "你是 Pi 原理课程中的简洁助手。只用中文回答，不调用工具。",
			model: options.model,
			messages: options.initialMessages ?? createInitialTranscript(),
		},
		transformContext: async (messages) => {
			trace.transformInput = messages.slice();
			trace.transformOutput = selectRequestWindow(messages);
			writeStep(options.output, 2, `transformContext 选择本轮记录：${describeMessages(trace.transformOutput)}`);
			return trace.transformOutput;
		},
		convertToLlm: (messages) => {
			trace.convertInput = messages.slice();
			trace.convertedMessages = convertMessagesForModel(messages);
			writeStep(options.output, 3, `convertToLlm 过滤界面记录：${describeMessages(trace.convertedMessages)}`);
			return trace.convertedMessages;
		},
		streamFn: (model, context, streamOptions) => {
			trace.sentMessages = context.messages.slice();
			writeStep(options.output, 3, `streamFn 实际收到的模型上下文：${describeMessages(context.messages)}`);
			return options.streamFn(model, context, streamOptions);
		},
		getApiKey: options.getApiKey,
	});

	return { agent, trace };
}

export function createRealRuntime(output: LessonOutput = consoleOutput): BoundaryRuntime {
	const runtime = createAnthropicCompatibleRuntime();
	return createBoundaryRuntime({
		model: runtime.model,
		streamFn: (model, context: Context, options) => runtime.models.streamSimple(model, context, options),
		getApiKey: () => runtime.apiKey,
		output,
	});
}

export async function runCode(options: RunCodeOptions = {}): Promise<BoundaryObservation> {
	const output = options.output ?? consoleOutput;
	const runtime = options.runtime ?? createRealRuntime(output);
	const prompt = options.prompt?.trim() || DEFAULT_PROMPT;
	writeStep(output, 1, `Agent 保存的完整记录：${describeMessages(runtime.agent.state.messages)}`);
	writeStep(output, 1, "发起本次提问；旧历史和界面提示会保留，但不一定送往模型。");
	await runtime.agent.prompt(prompt);

	const transcript = runtime.agent.state.messages.slice();
	const finalText = textFromFinalAssistant(transcript);
	const hasRuntimeError = runtime.agent.state.errorMessage !== undefined;
	writeStep(output, 4, `本轮后完整记录仍为：${describeMessages(transcript)}`);
	writeStep(output, 4, `最终回复：${finalText || "(无文本)"}`);
	if (hasRuntimeError) writeStep(output, 4, "模型请求未完成；完整记录仍可保留给界面处理。");
	return { trace: runtime.trace, transcript, finalText, hasRuntimeError };
}

export async function runLesson(): Promise<BoundaryObservation | undefined> {
	try {
		const result = await runCode({ prompt: process.env.LEARN_PI_PROMPT });
		if (result.hasRuntimeError) process.exitCode = 1;
		return result;
	} catch {
		console.error("[步骤 1/4] 模型请求未完成。请检查模型 ID、认证信息、Base URL 和 Provider 兼容性。");
		process.exitCode = 1;
		return undefined;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
