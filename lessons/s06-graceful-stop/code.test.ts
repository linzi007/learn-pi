import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { observeGracefulStop } from "./code.ts";

function createFauxAgent(response: string | null): Agent {
	const faux = fauxProvider({
		api: "learn-pi-s06-test",
		provider: "learn-pi-s06-test",
		models: [{ id: "learn-pi-s06-test", name: "Learn Pi Graceful Stop" }],
		tokenSize: { min: 1, max: 1 },
		tokensPerSecond: 1_000,
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(response === null ? [] : [fauxAssistantMessage(response, { timestamp: 0 })]);
	return new Agent({
		initialState: { systemPrompt: "只回复预设内容。", model: faux.getModel() },
		streamFn: (model, context, options) => models.streamSimple(model, context, options),
	});
}

describe("s06 graceful stop", () => {
	it("首个文字增量后中止，仍得到 aborted assistant、agent_end 和 idle state", async () => {
		const output: string[] = [];
		const observation = await observeGracefulStop({
			agent: createFauxAgent("这是一段足够长的固定回复，用来确保中止发生在流式生成的中间。"),
			prompt: "中止后会怎样？",
			output: { writeLine: (line) => output.push(line) },
		});

		expect(observation.abortRequested).toBe(true);
		expect(observation.stopReason).toBe("aborted");
		expect(observation.eventTypes).toContain("agent_end");
		expect(observation.eventTypes).toContain("turn_end");
		expect(observation.agentEndIsStreaming).toBe(true);
		expect(observation.idleAfterWait).toBe(true);
		expect(output).toContain("[步骤 3/4] 首个文字增量到达：调用 Agent.abort() 请求平稳停止。");
	});

	it("模型错误也形成结束消息并回到 idle，而不是留下半截运行", async () => {
		const observation = await observeGracefulStop({
			agent: createFauxAgent(null),
			prompt: "没有预设回复时会怎样？",
			abortOnFirstDelta: false,
			output: { writeLine: () => undefined },
		});

		expect(observation.abortRequested).toBe(false);
		expect(observation.stopReason).toBe("error");
		expect(observation.eventTypes.slice(-3)).toEqual(["message_end", "turn_end", "agent_end"]);
		expect(observation.idleAfterWait).toBe(true);
	});

	it("空闲时 abort 是 no-op，不产生事件也不阻塞 waitForIdle", async () => {
		const agent = createFauxAgent("不会使用这条回复。");
		agent.abort();
		await agent.waitForIdle();

		expect(agent.state.isStreaming).toBe(false);
		expect(agent.signal).toBeUndefined();
		expect(agent.state.messages).toEqual([]);
	});
});
