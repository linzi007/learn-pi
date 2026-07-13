import { pathToFileURL } from "node:url";
import { Agent, type AgentEvent, type AgentMessage, type AgentState } from "@earendil-works/pi-agent-core";
import { createAnthropicCompatibleRuntime } from "../../src/core/anthropic-compatible-runtime.ts";

const DEFAULT_PROMPT = "请用两句中文解释：Pi Agent 怎样把模型流变成界面可观察的状态？";

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface StateSnapshot {
	isStreaming: boolean;
	streamingMessageRole?: string;
	transcript: string[];
	hasError: boolean;
}

export interface TimelineEntry {
	type: AgentEvent["type"];
	detail: string;
	snapshot: StateSnapshot;
}

export interface RuntimeObservation {
	eventTypes: AgentEvent["type"][];
	timeline: TimelineEntry[];
	messageRoles: string[];
	finalState: StateSnapshot;
	finalText: string;
	agentEndIsStreaming?: boolean;
	hasRuntimeError: boolean;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
};

function snapshotState(state: AgentState): StateSnapshot {
	return {
		isStreaming: state.isStreaming,
		streamingMessageRole: state.streamingMessage?.role,
		transcript: state.messages.map((message) => message.role),
		hasError: state.errorMessage !== undefined,
	};
}

function assistantText(message: AgentMessage | undefined): string {
	if (message?.role !== "assistant") return "";
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function describeEvent(event: AgentEvent): string {
	switch (event.type) {
		case "message_start":
		case "message_end":
			return `${event.type}(${event.message.role})`;
		case "message_update":
			return `message_update(${event.assistantMessageEvent.type})`;
		case "turn_end":
			return event.message.role === "assistant" ? `turn_end(${event.message.stopReason})` : "turn_end";
		case "agent_end":
			return `agent_end(本次新增 ${event.messages.length} 条消息)`;
		default:
			return event.type;
	}
}

function formatSnapshot(snapshot: StateSnapshot): string {
	const transcript = snapshot.transcript.join(" -> ") || "(空)";
	const streaming = snapshot.streamingMessageRole ?? "-";
	const error = snapshot.hasError ? ", hasError=true" : "";
	return `isStreaming=${snapshot.isStreaming}, streamingMessage=${streaming}, transcript=${transcript}${error}`;
}

// 默认入口使用真实 Anthropic-compatible runtime；测试会从外部注入 faux Agent。
export function createRealAgent(): Agent {
	const runtime = createAnthropicCompatibleRuntime();
	return new Agent({
		initialState: {
			systemPrompt: "你是 Pi 原理课程中的简洁助手。只用中文回答。",
			model: runtime.model,
		},
		streamFn: (model, context, options) => runtime.models.streamSimple(model, context, options),
		getApiKey: () => runtime.apiKey,
	});
}

// 同一份观察逻辑既用于真实运行，也用于离线测试；它不替 Agent 维护第二份状态。
export async function observeAgentRun(
	agent: Agent,
	prompt: string,
	output: LessonOutput = consoleOutput,
): Promise<RuntimeObservation> {
	const timeline: TimelineEntry[] = [];
	let agentEndIsStreaming: boolean | undefined;
	const unsubscribe = agent.subscribe((event) => {
		const entry = {
			type: event.type,
			detail: describeEvent(event),
			snapshot: snapshotState(agent.state),
		};
		timeline.push(entry);
		if (event.type === "agent_end") agentEndIsStreaming = entry.snapshot.isStreaming;
		output.writeLine(`${entry.detail.padEnd(34)} | ${formatSnapshot(entry.snapshot)}`);
	});

	try {
		output.writeLine(`模型: ${agent.state.model.provider}/${agent.state.model.id}`);
		output.writeLine(`开始前: ${formatSnapshot(snapshotState(agent.state))}`);
		output.writeLine(`用户提问: ${prompt}`);
		await agent.prompt(prompt);
	} finally {
		unsubscribe();
	}

	const finalState = snapshotState(agent.state);
	const finalAssistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
	const finalText = assistantText(finalAssistant);
	output.writeLine(`结束后: ${formatSnapshot(finalState)}`);
	output.writeLine(`最终回复: ${finalText || "(无文本)"}`);

	return {
		eventTypes: timeline.map((entry) => entry.type),
		timeline,
		messageRoles: finalState.transcript,
		finalState,
		finalText,
		agentEndIsStreaming,
		hasRuntimeError: finalState.hasError,
	};
}

export async function runLesson(output: LessonOutput = consoleOutput): Promise<RuntimeObservation | undefined> {
	try {
		const observation = await observeAgentRun(
			createRealAgent(),
			process.env.LEARN_PI_PROMPT?.trim() || DEFAULT_PROMPT,
			output,
		);
		if (observation.hasRuntimeError) {
			console.error("真实模型调用未完成。请检查模型 ID、认证信息、Base URL 和 Provider 要求。");
			process.exitCode = 1;
		}
		return observation;
	} catch {
		console.error("真实模型调用未完成。请检查模型 ID、认证信息、Base URL 和 Provider 要求。");
		process.exitCode = 1;
		return undefined;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
