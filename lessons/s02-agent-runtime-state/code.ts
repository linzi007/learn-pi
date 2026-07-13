import { pathToFileURL } from "node:url";
import type { Agent, AgentEvent, AgentMessage, AgentState } from "@earendil-works/pi-agent-core";
import { createAnthropicAgent } from "../../src/core/anthropic-agent.ts";

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

// Pi 先更新 Agent.state，再向订阅者发布事件；这里读取同一时刻的状态，不另建一份 reducer。
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
	return createAnthropicAgent("你是 Pi 原理课程中的简洁助手。只用中文回答。");
}

// 主链路：先订阅 Pi 的事件，再发起 prompt，最后从 Pi 已收束的 state 读取结果。
// 同一份观察逻辑既用于真实运行，也用于离线测试；它不替 Agent 维护第二份状态。
export async function observeAgentRun(
	agent: Agent,
	prompt: string,
	output: LessonOutput = consoleOutput,
): Promise<RuntimeObservation> {
	const timeline: TimelineEntry[] = [];
	let agentEndIsStreaming: boolean | undefined;
	let announcedAgentStart = false;
	let announcedTextDelta = false;
	const unsubscribe = agent.subscribe((event) => {
		// 将事件与此刻 state 配对，才能看出“流开始/结束”和 transcript 写入的先后关系。
		const entry = {
			type: event.type,
			detail: describeEvent(event),
			snapshot: snapshotState(agent.state),
		};
		timeline.push(entry);
		if (event.type === "agent_end") agentEndIsStreaming = entry.snapshot.isStreaming;
		if (event.type === "agent_start" && !announcedAgentStart) {
			announcedAgentStart = true;
			output.writeLine("[步骤 2/4] Pi 开始本轮：事件到达前，运行状态已经切换为运行中。");
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta" && !announcedTextDelta) {
			announcedTextDelta = true;
			output.writeLine("[步骤 3/4] 首个文字增量到达：只更新临时助手消息，不写入完整历史。");
		}
		output.writeLine(`${entry.detail.padEnd(34)} | ${formatSnapshot(entry.snapshot)}`);
	});

	try {
		// Agent.prompt() 负责驱动模型流和状态转换；本课只观察，不手动修改 state。
		output.writeLine("[步骤 1/4] 记录发起前的状态快照，并订阅本轮事件。");
		output.writeLine(`模型: ${agent.state.model.provider}/${agent.state.model.id}`);
		output.writeLine(`开始前: ${formatSnapshot(snapshotState(agent.state))}`);
		output.writeLine(`用户提问: ${prompt}`);
		await agent.prompt(prompt);
	} finally {
		// 真实 Agent 可复用，观察者不能遗留订阅。
		unsubscribe();
	}

	// prompt 返回后流已结束，最后一条 assistant 消息可从 Pi 维护的 transcript 安全读取。
	const finalState = snapshotState(agent.state);
	const finalAssistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
	const finalText = assistantText(finalAssistant);
	output.writeLine("[步骤 4/4] 本轮结束：读取已经收束的状态和完整回复。");
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
