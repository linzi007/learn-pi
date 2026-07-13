import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { observeAgentRun } from "./code.ts";

function createFauxAgent(response: string | null): Agent {
	const faux = fauxProvider({
		api: "learn-pi-s02-test",
		provider: "learn-pi-s02-test",
		models: [{ id: "learn-pi-s02-test", name: "Learn Pi Runtime State" }],
		tokenSize: { min: 2, max: 2 },
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(response === null ? [] : [fauxAssistantMessage(response, { timestamp: 0 })]);

	return new Agent({
		initialState: { systemPrompt: "只回复预设内容。", model: faux.getModel() },
		streamFn: (model, context, options) => models.streamSimple(model, context, options),
	});
}

describe("s02 agent runtime state", () => {
	it("模型事件被归约为 agent、turn、message 生命周期和最终 transcript", async () => {
		const observation = await observeAgentRun(
			createFauxAgent("Pi Agent 先归约状态，再通知界面。"),
			"Pi Agent 如何组织模型输出？",
			{ writeLine: () => undefined },
		);

		expect(observation.eventTypes.slice(0, 5)).toEqual([
			"agent_start",
			"turn_start",
			"message_start",
			"message_end",
			"message_start",
		]);
		expect(observation.timeline.map((entry) => entry.detail)).toContain("message_update(text_delta)");
		expect(observation.eventTypes.slice(-3)).toEqual(["message_end", "turn_end", "agent_end"]);
		expect(observation.messageRoles).toEqual(["user", "assistant"]);
		expect(observation.finalText).toBe("Pi Agent 先归约状态，再通知界面。");

		const userStart = observation.timeline.find((entry) => entry.detail === "message_start(user)");
		expect(userStart?.snapshot).toMatchObject({
			isStreaming: true,
			streamingMessageRole: "user",
			transcript: [],
			hasError: false,
		});
		expect(observation.agentEndIsStreaming).toBe(true);
		expect(observation.finalState).toEqual({
			isStreaming: false,
			streamingMessageRole: undefined,
			transcript: ["user", "assistant"],
			hasError: false,
		});
	});

	it("模型错误仍形成 assistant 消息和 agent_end，观察层不输出原始错误内容", async () => {
		const output: string[] = [];
		const observation = await observeAgentRun(createFauxAgent(null), "会失败吗？", {
			writeLine: (line) => output.push(line),
		});

		expect(observation.eventTypes).toEqual([
			"agent_start",
			"turn_start",
			"message_start",
			"message_end",
			"message_start",
			"message_end",
			"turn_end",
			"agent_end",
		]);
		expect(observation.messageRoles).toEqual(["user", "assistant"]);
		expect(observation.finalText).toBe("");
		expect(observation.finalState).toMatchObject({
			isStreaming: false,
			transcript: ["user", "assistant"],
			hasError: true,
		});
		expect(observation.agentEndIsStreaming).toBe(true);
		expect(output.join("\n")).not.toContain("No more faux responses queued");
	});
});
