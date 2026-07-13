import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmbeddedResearchHarness, FINAL_RESPONSE, runEmbeddedResearch } from "./code.ts";

describe("s12 embedded harness", () => {
	it("将临时资源、Skill、审计扩展和只读工具接入同一个 AgentSession", async () => {
		const lines: string[] = [];
		const observation = await runEmbeddedResearch({ writeLine: (line) => lines.push(line) });

		expect(observation.activeToolNames).toEqual(["read", "grep", "find", "ls"]);
		expect(observation.loadedAgents).toEqual(["AGENTS.md"]);
		expect(observation.loadedSkills).toEqual(["fixture-research"]);
		expect(observation.auditLog).toEqual([
			"extension:session_start",
			"extension:agent_start",
			"extension:tool_call:read",
			"extension:tool_result:read",
			"extension:agent_end",
		]);
		expect(observation.auditedReadResult).toContain("[审计] 研究结论：嵌入式宿主应显式提供运行依赖。");
		expect(observation.finalText).toBe(FINAL_RESPONSE);
		expect(observation.modelCallCount).toBe(2);
		expect(lines).toContain("[步骤 5/5] 验证：资源和 Skill 已进入系统提示，read 结果经过扩展审计，内存会话随后释放。");
	});

	it("不读取环境 API Key 或用户目录，且审计后的 read 结果进入下一次模型请求", async () => {
		const originalKey = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = "must-not-be-used";
		const harness = await createEmbeddedResearchHarness();

		try {
			expect(harness.session.model?.provider).toBe("learn-pi-s12-fixture");
			expect(harness.session.sessionFile).toBeUndefined();
			expect(harness.session.getActiveToolNames()).not.toContain("write");
			expect(harness.session.getActiveToolNames()).not.toContain("edit");
			const resourcePaths = [
				...harness.resourceLoader.getAgentsFiles().agentsFiles.map((file) => file.path),
				...harness.resourceLoader.getSkills().skills.map((skill) => skill.filePath),
			];
			expect(resourcePaths.every((path) => path.startsWith(harness.fixture.cwd))).toBe(true);

			await harness.session.prompt("读取项目笔记");
			await harness.session.waitForIdle();
			expect(harness.requestTranscripts).toHaveLength(2);
			expect(harness.requestTranscripts[1]?.join("\n")).toContain("[审计] 研究结论：嵌入式宿主应显式提供运行依赖。");
		} finally {
			await harness.dispose();
			if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
			else process.env.ANTHROPIC_API_KEY = originalKey;
		}
	});

	it("释放 harness 时删除临时项目，不留下会话或测试资源", async () => {
		const harness = await createEmbeddedResearchHarness();
		const fixtureCwd = harness.fixture.cwd;
		expect(existsSync(fixtureCwd)).toBe(true);

		await harness.dispose();
		await harness.dispose();
		expect(existsSync(fixtureCwd)).toBe(false);
	});
});
