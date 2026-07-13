import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createBoundaryRuntime, createUiNotice, type LessonOutput, runCode } from "./code.ts";

function createFauxRuntime(initialMessages?: AgentMessage[], output?: LessonOutput) {
	const faux = fauxProvider({
		api: "learn-pi-s04-test",
		provider: "learn-pi-s04-test",
		models: [{ id: "learn-pi-s04-test", name: "Learn Pi Message Boundary" }],
		tokenSize: { min: 2, max: 2 },
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([fauxAssistantMessage("模型只收到本轮问题。", { timestamp: 10 })]);
	return createBoundaryRuntime({
		model: faux.getModel(),
		streamFn: (model, context, options) => models.streamSimple(model, context, options),
		initialMessages,
		output,
	});
}

describe("s04 message boundary", () => {
	it("保存的完整记录经过两层边界后，模型只收到本轮 user 消息", async () => {
		const lines: string[] = [];
		const output = { writeLine: (line: string) => lines.push(line) };
		const observation = await runCode({
			runtime: createFauxRuntime(undefined, output),
			prompt: "本轮问题：解释消息边界。",
			output,
		});

		expect(observation.trace.transformInput.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"notice",
			"user",
		]);
		expect(observation.trace.transformOutput.map((message) => message.role)).toEqual(["notice", "user"]);
		expect(observation.trace.convertInput).toEqual(observation.trace.transformOutput);
		expect(observation.trace.convertedMessages.map((message) => message.role)).toEqual(["user"]);
		expect(observation.trace.sentMessages.map((message) => message.role)).toEqual(["user"]);
		expect(observation.transcript.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"notice",
			"user",
			"assistant",
		]);
		expect(observation.finalText).toBe("模型只收到本轮问题。");
		expect(observation.hasRuntimeError).toBe(false);
		expect(lines).toContain("[步骤 2/4] transformContext 选择本轮记录：界面提示（notice） -> user");
		expect(lines).toContain("[步骤 3/4] streamFn 实际收到的模型上下文：user");
		expect(lines.every((line) => /^\[步骤 [1-4]\/4\]/.test(line))).toBe(true);
	});

	it("记录很短时，界面提示仍被过滤，当前用户消息不会被窗口裁掉", async () => {
		const noticeOnly: AgentMessage[] = [createUiNotice("只显示给界面的状态。", 1)];
		const observation = await runCode({
			runtime: createFauxRuntime(noticeOnly),
			prompt: "短记录也要能请求模型。",
			output: { writeLine: () => undefined },
		});

		expect(observation.trace.transformInput.map((message) => message.role)).toEqual(["notice", "user"]);
		expect(observation.trace.transformOutput.map((message) => message.role)).toEqual(["notice", "user"]);
		expect(observation.trace.convertedMessages.map((message) => message.role)).toEqual(["user"]);
		expect(observation.trace.sentMessages.map((message) => message.role)).toEqual(["user"]);
		expect(observation.transcript.map((message) => message.role)).toEqual(["notice", "user", "assistant"]);
	});
});
