import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { estimateTokens, generateSummary } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { appendFixedCheckpoint, createCompactionScenario, runLesson } from "./code.ts";

describe("s09 Session Compaction", () => {
	it("短上下文刚好达到阈值时不新增 compaction entry", () => {
		const scenario = createCompactionScenario();
		const threshold = scenario.contextWindow - scenario.settings.reserveTokens;
		const decision = appendFixedCheckpoint(scenario, threshold);

		expect(decision.status).toBe("not-needed");
		expect(scenario.session.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
		expect(scenario.session.getLeafId()).toBe(scenario.ids.D);
	});

	it("在 user 边界切分时，摘要替代旧记录而完整回合 C -> D 保留", () => {
		const lines: string[] = [];
		const result = runLesson({ writeLine: (line) => lines.push(line) });

		expect(result.shortContextWouldCompact).toBe(false);
		expect(result.compactionAppended).toBe(true);
		expect(result.cut).toMatchObject({ status: "appended", isSplitTurn: false, turnStartIndex: -1 });
		expect(result.fullEntryLabels).toEqual(["A", "B", "C", "D", "摘要"]);
		expect(result.contextEntryLabels).toEqual(["摘要", "C", "D"]);
		expect(result.contextRoles).toEqual(["compactionSummary", "user", "assistant"]);
		expect(result.compactionParentLabel).toBe("D");
		expect(lines).toContain("[步骤 4/5] 从当前末端重建模型上下文：摘要 -> C -> D");
		expect(lines.every((line) => /^\[步骤 [1-5]\/5\]/.test(line))).toBe(true);
	});

	it("若预算会把切点放进回合，教学入口不写半截摘要而要求回合前缀摘要", () => {
		const scenario = createCompactionScenario();
		const lastMessage = scenario.session.buildSessionContext().messages.at(-1);
		if (!lastMessage) throw new Error("fixture missing last message");
		scenario.settings.keepRecentTokens = estimateTokens(lastMessage);

		const decision = appendFixedCheckpoint(scenario, scenario.tokensBefore);

		expect(decision.status).toBe("requires-turn-prefix");
		expect(decision.isSplitTurn).toBe(true);
		expect(decision.turnStartIndex).toBe(2);
		expect(decision.firstKeptEntryId).toBe(scenario.ids.D);
		expect(scenario.session.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
	});

	it("模型摘要失败会以 Pi 的摘要错误向上返回，不产生伪造检查点", async () => {
		const scenario = createCompactionScenario();
		const faux = fauxProvider({
			api: "learn-pi-s09-test",
			provider: "learn-pi-s09-test",
			models: [{ id: "learn-pi-s09-test", name: "Learn Pi Compaction" }],
			tokenSize: { min: 2, max: 2 },
		});
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "offline summary failure" })]);

		await expect(
			generateSummary(
				[{ role: "user", content: "需要生成摘要。", timestamp: 0 }],
				faux.getModel(),
				100,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				(model, context, options) => models.streamSimple(model, context, options),
			),
		).rejects.toThrow("Summarization failed: offline summary failure");
		expect(scenario.session.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
	});
});
