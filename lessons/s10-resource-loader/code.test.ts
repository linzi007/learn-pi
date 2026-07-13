import { describe, expect, it } from "vitest";
import { runLesson } from "./code.ts";

describe("s10 ResourceLoader", () => {
	it("按 agentDir、父目录、子目录的顺序加载上下文文件", async () => {
		const result = await runLesson({ writeLine: () => undefined });

		expect(result.contextOrder).toEqual(["全局", "父", "子"]);
	});

	it("同名技能保留第一个、报告碰撞和坏 frontmatter，并排除仅手动技能", async () => {
		const result = await runLesson({ writeLine: () => undefined });

		expect(result.skills).toEqual([
			{ name: "inspect", scope: "user" },
			{ name: "manual", scope: "project" },
		]);
		expect(result.skillCollisionCount).toBe(1);
		expect(result.badSkillDiagnosticCount).toBeGreaterThanOrEqual(1);
		expect(result.modelVisibleSkillNames).toEqual(["inspect"]);
	});

	it("同名提示词保留第一个，并在禁用默认发现后不加载任何资源", async () => {
		const lines: string[] = [];
		const result = await runLesson({ writeLine: (line) => lines.push(line) });

		expect(result.prompts).toEqual([{ name: "review", scope: "user" }]);
		expect(result.promptCollisionCount).toBe(1);
		expect(result.disabledCounts).toEqual({ contexts: 0, skills: 0, prompts: 0 });
		expect(lines).toContain("[步骤 1/4] 上下文顺序：全局 -> 父 -> 子");
		expect(lines.every((line) => /^\[步骤 [1-4]\/4\]/.test(line))).toBe(true);
	});
});
