import { pathToFileURL } from "node:url";
import type { Agent, AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createAnthropicAgent } from "../../src/core/anthropic-agent.ts";

const DEFAULT_PROMPT = "请用一句中文说明：Pi 正在回答一个问题。";
const DEFAULT_STEERING = "请把接下来的回答改成一句话，并只说明当前任务状态。";
const DEFAULT_FOLLOW_UP = "现在任务已经结束，请用一句话总结这三次回复的先后顺序。";

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface QueueDelivery {
	kind: "steering" | "follow-up";
	text: string;
	messageIndex: number;
}

export interface QueueObservation {
	eventTypes: AgentEvent["type"][];
	deliveries: QueueDelivery[];
	transcript: string[];
	queuedAfterAssistantStart: boolean;
	hasQueuedMessagesAfterRun: boolean;
	hasRuntimeError: boolean;
}

export interface ObserveQueueOptions {
	prompt?: string;
	steeringText?: string;
	followUpText?: string;
	output?: LessonOutput;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
};

function messageText(message: AgentMessage): string {
	if (!("content" in message)) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function createQueuedMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function transcriptLine(message: AgentMessage): string {
	const text = messageText(message) || "(无文本)";
	return `${message.role}: ${text}`;
}

/**
 * 默认入口使用项目统一的 Anthropic-compatible runtime；本课只在 Agent API 上观察两条队列。
 * 系统提示刻意禁用工具，避免工具批次掩盖“助手回合结束后”这个唯一教学边界。
 */
export function createRealAgent(): Agent {
	return createAnthropicAgent("你是 Pi 原理课程中的简洁助手。只用中文回答，不调用工具。严格遵从用户的最新要求。");
}

/**
 * 在首个 assistant message 开始时，将两条用户消息分别放入两条 Pi 队列。
 * 这时第一条回复已经开始，消息不会直接写入 transcript；Agent loop 会在自己的 drain point 决定何时取出。
 */
export async function observeMessageQueues(
	agent: Agent,
	{
		prompt = DEFAULT_PROMPT,
		steeringText = DEFAULT_STEERING,
		followUpText = DEFAULT_FOLLOW_UP,
		output = consoleOutput,
	}: ObserveQueueOptions = {},
): Promise<QueueObservation> {
	const eventTypes: AgentEvent["type"][] = [];
	const deliveries: QueueDelivery[] = [];
	let queued = false;
	let queuedAfterAssistantStart = false;

	output.writeLine("s05：Pi 消息队列的两个取出时机");
	output.writeLine(`[步骤 1/5] 发起首个问题：${prompt}`);

	const unsubscribe = agent.subscribe((event) => {
		eventTypes.push(event.type);

		if (event.type === "message_start" && event.message.role === "assistant" && !queued) {
			queued = true;
			agent.steer(createQueuedMessage(steeringText));
			agent.followUp(createQueuedMessage(followUpText));
			queuedAfterAssistantStart = agent.hasQueuedMessages();
			output.writeLine("[步骤 2/5] 首个助手回复已开始：分别放入一条引导消息和一条后续消息；它们还不在会话记录中。");
			return;
		}

		if (event.type !== "message_start" || event.message.role !== "user") return;
		const text = messageText(event.message);
		if (text === steeringText) {
			deliveries.push({ kind: "steering", text, messageIndex: agent.state.messages.length });
			output.writeLine("[步骤 3/5] 当前助手回合结束后：先取出引导消息，开始下一次模型请求。");
		}
		if (text === followUpText) {
			deliveries.push({ kind: "follow-up", text, messageIndex: agent.state.messages.length });
			output.writeLine("[步骤 4/5] 没有工具调用，也没有引导消息后：才取出后续消息，开始下一次模型请求。");
		}
	});

	try {
		await agent.prompt(prompt);
	} finally {
		// Agent 可复用；课程的观察订阅不能残留到下一次 prompt。
		unsubscribe();
	}

	const finalAssistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
	const hasRuntimeError =
		agent.state.errorMessage !== undefined ||
		(finalAssistant?.role === "assistant" &&
			(finalAssistant.stopReason === "error" || finalAssistant.stopReason === "aborted"));
	const transcript = agent.state.messages.map(transcriptLine);

	output.writeLine("[步骤 5/5] 本轮结束：查看队列取出后的会话记录。");
	output.writeLine(`取出顺序: ${deliveries.map((delivery) => delivery.kind).join(" -> ") || "(无消息被取出)"}`);
	output.writeLine(`会话记录: ${transcript.join(" | ") || "(空)"}`);

	return {
		eventTypes,
		deliveries,
		transcript,
		queuedAfterAssistantStart,
		hasQueuedMessagesAfterRun: agent.hasQueuedMessages(),
		hasRuntimeError,
	};
}

export async function runLesson(output: LessonOutput = consoleOutput): Promise<QueueObservation | undefined> {
	try {
		const observation = await observeMessageQueues(createRealAgent(), {
			prompt: process.env.LEARN_PI_PROMPT?.trim() || DEFAULT_PROMPT,
			output,
		});
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
