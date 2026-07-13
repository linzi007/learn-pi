import { pathToFileURL } from "node:url";
import type { Agent, AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createAnthropicAgent } from "../../src/core/anthropic-agent.ts";

const DEFAULT_PROMPT = "请用三句中文解释：为什么中止模型生成后，Pi 仍需要把这一轮收束为可保存的结束状态？";

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface StopObservation {
	eventTypes: AgentEvent["type"][];
	stopReason?: string;
	finalText: string;
	abortRequested: boolean;
	agentEndIsStreaming?: boolean;
	idleAfterWait: boolean;
	hasError: boolean;
}

export interface ObserveStopOptions {
	agent: Agent;
	prompt: string;
	abortOnFirstDelta?: boolean;
	output?: LessonOutput;
}

const consoleOutput: LessonOutput = { writeLine: (text) => console.log(text) };

function assistantText(message: AgentMessage | undefined): string {
	if (message?.role !== "assistant") return "";
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function latestAssistant(agent: Agent): Extract<AgentMessage, { role: "assistant" }> | undefined {
	return [...agent.state.messages]
		.reverse()
		.find((message): message is Extract<AgentMessage, { role: "assistant" }> => {
			return message.role === "assistant";
		});
}

// 默认入口只负责创建真实 Agent；中止、事件观察和空闲收束由同一条 run 函数处理。
export function createRealAgent(): Agent {
	return createAnthropicAgent("你是 Learn Pi 原理课程中的简洁助手。只用中文回答，不调用工具。");
}

/**
 * 从首次文字增量开始请求中止，并把 "agent_end" 与真正回到 idle 的时刻分开观察。
 * 测试注入 faux Agent，真实入口则使用同一条 Agent 生命周期。
 */
export async function observeGracefulStop({
	agent,
	prompt,
	abortOnFirstDelta = true,
	output = consoleOutput,
}: ObserveStopOptions): Promise<StopObservation> {
	const eventTypes: AgentEvent["type"][] = [];
	let abortRequested = false;
	let agentEndIsStreaming: boolean | undefined;

	const unsubscribe = agent.subscribe((event) => {
		eventTypes.push(event.type);
		if (event.type === "agent_start") {
			output.writeLine("[步骤 2/4] Pi 开始本轮：运行状态切换为 isStreaming=true。");
		}
		if (
			abortOnFirstDelta &&
			!abortRequested &&
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			abortRequested = true;
			output.writeLine("[步骤 3/4] 首个文字增量到达：调用 Agent.abort() 请求平稳停止。");
			agent.abort();
		}
		if (event.type === "agent_end") {
			agentEndIsStreaming = agent.state.isStreaming;
			output.writeLine(
				`[步骤 4/4] 收到 agent_end：此时 isStreaming=${agentEndIsStreaming}，还要等待运行器真正回到空闲。`,
			);
		}
	});

	try {
		output.writeLine("[步骤 1/4] 发起模型请求，并提前订阅本轮生命周期事件。");
		await agent.prompt(prompt);
		await agent.waitForIdle();
	} finally {
		// 监听器只属于本次观察；真实 Agent 可以被后续课程或宿主继续复用。
		unsubscribe();
	}

	const assistant = latestAssistant(agent);
	const stopReason = assistant?.stopReason;
	const idleAfterWait = !agent.state.isStreaming && agent.signal === undefined;
	output.writeLine(
		`[步骤 4/4] waitForIdle 完成：isStreaming=${agent.state.isStreaming}，signal=${agent.signal ? "仍存在" : "已释放"}。`,
	);
	output.writeLine(`结束原因：${stopReason ?? "(没有 assistant 消息)"}`);
	output.writeLine(`最终文本：${assistantText(assistant) || "(中止前没有完整文本)"}`);

	return {
		eventTypes,
		stopReason,
		finalText: assistantText(assistant),
		abortRequested,
		agentEndIsStreaming,
		idleAfterWait,
		hasError: stopReason === "error",
	};
}

export async function runLesson(output: LessonOutput = consoleOutput): Promise<StopObservation | undefined> {
	try {
		const observation = await observeGracefulStop({
			agent: createRealAgent(),
			prompt: process.env.LEARN_PI_PROMPT?.trim() || DEFAULT_PROMPT,
			output,
		});
		if (observation.hasError) {
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
