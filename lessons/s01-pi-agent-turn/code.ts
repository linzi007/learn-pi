import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import type { Agent, AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createAnthropicAgent } from "../../src/core/anthropic-agent.ts";

const EXIT_COMMANDS = new Set(["/exit", "exit", "quit", "q"]);

export interface LessonOutput {
	writeLine(text: string): void;
	writeChunk?(text: string): void;
}

export interface TurnObservation {
	eventTypes: AgentEvent["type"][];
	finalText: string;
	hasRuntimeError: boolean;
}

export interface InteractiveLessonOptions {
	agent: Agent;
	readQuestion: (prompt: string) => Promise<string | undefined>;
	output?: LessonOutput;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
	writeChunk: (text) => stdout.write(text),
};

function assistantText(message: AgentMessage | undefined): string {
	if (message?.role !== "assistant") return "";
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function writeDelta(output: LessonOutput, text: string) {
	if (output.writeChunk) output.writeChunk(text);
	else output.writeLine(`  ${text}`);
}

/**
 * 只观察 Pi Agent 对一条用户输入做了什么。
 *
 * learn-claude-code 的首课把循环写在应用代码里；这里不重写循环，
 * 而是订阅 Pi 已经管理好的事件，观察它何时开始、何时流式输出、何时收束。
 */
export async function runAgentTurn(
	agent: Agent,
	question: string,
	output: LessonOutput = consoleOutput,
): Promise<TurnObservation> {
	const eventTypes: AgentEvent["type"][] = [];
	let wroteStreamingText = false;

	output.writeLine("");
	output.writeLine(`[步骤 1/4] 收到用户输入：${question}`);
	const unsubscribe = agent.subscribe((event) => {
		eventTypes.push(event.type);

		if (event.type === "agent_start") {
			output.writeLine("[步骤 2/4] Pi Agent 接手本轮：维护消息历史并开始调用模型。");
			return;
		}

		// Agent 把底层模型流转换为 message_update；本课只显示文本增量。
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			if (!wroteStreamingText) {
				wroteStreamingText = true;
				output.writeLine("[步骤 3/4] 模型正在分段输出：");
			}
			writeDelta(output, event.assistantMessageEvent.delta);
		}
	});

	try {
		await agent.prompt(question);
	} finally {
		unsubscribe();
	}

	if (wroteStreamingText && output.writeChunk) output.writeLine("");
	const finalAssistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
	const finalText = assistantText(finalAssistant);
	const hasRuntimeError =
		agent.state.errorMessage !== undefined ||
		(finalAssistant?.role === "assistant" &&
			(finalAssistant.stopReason === "error" || finalAssistant.stopReason === "aborted"));

	output.writeLine("[步骤 4/4] 本轮结束：Pi 已把完整回复写入当前会话历史。");
	output.writeLine(`完整回复：${finalText || "(无文本)"}`);
	output.writeLine(`本轮事件：${eventTypes.join(" -> ")}`);

	return { eventTypes, finalText, hasRuntimeError };
}

/**
 * 连续读取问题，复用同一个 Agent。
 *
 * 这正是本课与“一次固定 prompt 后退出”的区别：第二个问题会带着第一轮
 * 已完成的 user/assistant 消息进入 Pi 管理的会话，而不是由课程手工拼接数组。
 */
export async function runInteractiveLesson({ agent, readQuestion, output = consoleOutput }: InteractiveLessonOptions) {
	output.writeLine("s01：Pi 接管手写 Agent Loop");
	output.writeLine("输入问题后观察四个步骤；输入 /exit 退出。\n");

	while (true) {
		const input = await readQuestion("s01 >> ");
		if (input === undefined) break;
		const question = input.trim();
		if (EXIT_COMMANDS.has(question.toLowerCase())) break;
		if (!question) continue;

		const observation = await runAgentTurn(agent, question, output);
		if (observation.hasRuntimeError) break;
	}

	output.writeLine("s01 已结束。");
	return agent.state.messages;
}

export async function runLesson(output: LessonOutput = consoleOutput) {
	try {
		const agent = createAnthropicAgent();
		const oneShotPrompt = process.env.LEARN_PI_PROMPT?.trim();
		if (oneShotPrompt) return await runAgentTurn(agent, oneShotPrompt, output);

		const terminal = createInterface({ input: stdin, output: stdout });
		try {
			return await runInteractiveLesson({
				agent,
				readQuestion: (prompt) => terminal.question(prompt),
				output,
			});
		} finally {
			terminal.close();
		}
	} catch {
		console.error("真实模型调用未完成。请检查模型 ID、认证信息、Base URL 和 Provider 要求。");
		process.exitCode = 1;
		return undefined;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
