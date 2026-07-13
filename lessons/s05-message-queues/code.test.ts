import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { observeMessageQueues } from "./code.ts";

function textOf(message: AgentMessage): string {
	if (!("content" in message)) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("");
}

function createQueuedUserMessage(text: string) {
	return {
		role: "user" as const,
		content: [{ type: "text" as const, text }],
		timestamp: 0,
	};
}

function createFauxAgent(responses: string[]) {
	const faux = fauxProvider({
		api: "learn-pi-s05-test",
		provider: "learn-pi-s05-test",
		models: [{ id: "learn-pi-s05-test", name: "Learn Pi Message Queues" }],
		tokenSize: { min: 2, max: 2 },
	});
	const models = createModels();
	const requestUserTexts: string[][] = [];
	models.setProvider(faux.provider);
	faux.setResponses(responses.map((text) => fauxAssistantMessage(text, { timestamp: 0 })));

	const agent = new Agent({
		initialState: { systemPrompt: "只回复预设内容。", model: faux.getModel() },
		streamFn: (model, context, options) => {
			requestUserTexts.push(context.messages.filter((message) => message.role === "user").map(textOf));
			return models.streamSimple(model, context, options);
		},
	});

	return { agent, requestUserTexts };
}

describe("s05 message queues", () => {
	it("steering 在当前助手回合结束后先被取出，并作为下一次请求的用户消息", async () => {
		const { agent, requestUserTexts } = createFauxAgent(["第一轮", "第二轮", "第三轮"]);
		const observation = await observeMessageQueues(agent, {
			prompt: "初始问题",
			steeringText: "立刻改成简短答案",
			followUpText: "完成后再总结",
			output: { writeLine: () => undefined },
		});

		expect(observation.queuedAfterAssistantStart).toBe(true);
		expect(observation.deliveries.map((delivery) => delivery.kind)).toEqual(["steering", "follow-up"]);
		expect(observation.transcript).toEqual([
			"user: 初始问题",
			"assistant: 第一轮",
			"user: 立刻改成简短答案",
			"assistant: 第二轮",
			"user: 完成后再总结",
			"assistant: 第三轮",
		]);
		expect(requestUserTexts).toEqual([
			["初始问题"],
			["初始问题", "立刻改成简短答案"],
			["初始问题", "立刻改成简短答案", "完成后再总结"],
		]);
	});

	it("follow-up 只在没有工具调用和 steering 后取出，不抢在 steering 前面", async () => {
		const { agent } = createFauxAgent(["第一轮", "第二轮", "第三轮"]);
		const lines: string[] = [];
		const observation = await observeMessageQueues(agent, {
			output: { writeLine: (line) => lines.push(line) },
		});

		const steeringStep = lines.indexOf("[步骤 3/5] 当前助手回合结束后：先取出引导消息，开始下一次模型请求。");
		const followUpStep = lines.indexOf(
			"[步骤 4/5] 没有工具调用，也没有引导消息后：才取出后续消息，开始下一次模型请求。",
		);
		expect(steeringStep).toBeGreaterThan(0);
		expect(followUpStep).toBeGreaterThan(steeringStep);
		expect(observation.deliveries[0]?.messageIndex).toBeLessThan(observation.deliveries[1]?.messageIndex ?? 0);
		expect(observation.hasQueuedMessagesAfterRun).toBe(false);
	});

	it("clearAllQueues 会移除尚未被 loop 取出的两条消息", async () => {
		const { agent, requestUserTexts } = createFauxAgent(["唯一回复"]);
		agent.steer(createQueuedUserMessage("不应出现的引导消息"));
		agent.followUp(createQueuedUserMessage("不应出现的后续消息"));

		expect(agent.hasQueuedMessages()).toBe(true);
		agent.clearAllQueues();
		expect(agent.hasQueuedMessages()).toBe(false);

		await agent.prompt("只处理这一条");
		expect(requestUserTexts).toEqual([["只处理这一条"]]);
		expect(agent.state.messages.map((message) => textOf(message))).not.toContain("不应出现的引导消息");
		expect(agent.state.messages.map((message) => textOf(message))).not.toContain("不应出现的后续消息");
	});
});
