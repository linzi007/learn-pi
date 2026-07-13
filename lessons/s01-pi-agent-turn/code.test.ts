import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { runAgentTurn, runInteractiveLesson } from "./code.ts";

function createFauxAgent(responses: string[]): Agent {
	const faux = fauxProvider({
		api: "learn-pi-s01-test",
		provider: "learn-pi-s01-test",
		models: [{ id: "learn-pi-s01-test", name: "Learn Pi Interactive Agent" }],
		tokenSize: { min: 2, max: 2 },
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(responses.map((response) => fauxAssistantMessage(response, { timestamp: 0 })));

	return new Agent({
		initialState: { systemPrompt: "只回复预设内容。", model: faux.getModel() },
		streamFn: (model, context, options) => models.streamSimple(model, context, options),
	});
}

describe("s01 Pi Agent interactive turn", () => {
	it("按四个可观察步骤完成一轮输入、流式输出和收束", async () => {
		const lines: string[] = [];
		const chunks: string[] = [];
		const observation = await runAgentTurn(createFauxAgent(["Pi 接管了手写循环。"]), "Pi 做了什么？", {
			writeLine: (line) => lines.push(line),
			writeChunk: (chunk) => chunks.push(chunk),
		});

		expect(lines).toContain("[步骤 1/4] 收到用户输入：Pi 做了什么？");
		expect(lines).toContain("[步骤 2/4] Pi Agent 接手本轮：维护消息历史并开始调用模型。");
		expect(lines).toContain("[步骤 3/4] 模型正在分段输出：");
		expect(lines).toContain("[步骤 4/4] 本轮结束：Pi 已把完整回复写入当前会话历史。");
		expect(chunks.join("")).toBe("Pi 接管了手写循环。");
		expect(observation.eventTypes).toContain("agent_start");
		expect(observation.eventTypes).toContain("agent_end");
		expect(observation.finalText).toBe("Pi 接管了手写循环。");
		expect(observation.hasRuntimeError).toBe(false);
	});

	it("连续输入复用同一个 Pi Agent，而不是手工拼接历史", async () => {
		const agent = createFauxAgent(["第一轮回复。", "第二轮回复。"]);
		const inputs = ["第一问", "第二问", "/exit"];
		const lines: string[] = [];
		const messages = await runInteractiveLesson({
			agent,
			readQuestion: async () => inputs.shift(),
			output: { writeLine: (line) => lines.push(line), writeChunk: () => undefined },
		});

		expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
		expect(lines.filter((line) => line.startsWith("[步骤 1/4]"))).toHaveLength(2);
		expect(lines.at(-1)).toBe("s01 已结束。");
	});

	it("模型失败仍收束本轮，不把 faux Provider 原始错误写进教学输出", async () => {
		const lines: string[] = [];
		const observation = await runAgentTurn(createFauxAgent([]), "会失败吗？", {
			writeLine: (line) => lines.push(line),
		});

		expect(observation.hasRuntimeError).toBe(true);
		expect(observation.eventTypes).toContain("agent_end");
		expect(lines.join("\n")).not.toContain("No more faux responses queued");
	});
});
