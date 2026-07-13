import { describe, expect, it } from "vitest";
import { createSessionTreeFixture, labelsForContext } from "../../src/testing/session-tree-fixture.ts";
import { runLesson } from "./code.ts";

describe("s08 Session Tree", () => {
	it("保留旧分支，却只从当前 leaf 重建 Context", async () => {
		const result = await runLesson({ output: { writeLine: () => undefined } });

		expect(result.persisted).toBe(false);
		expect(result.sessionFile).toBeUndefined();
		expect(result.contextBeforeReset).toEqual(["A", "B", "D"]);
		expect(result.contextForOriginalBranch).toEqual(["A", "B", "C"]);
		expect(result.treeBeforeReset).toEqual([
			"A [message]",
			"   `- B [message]",
			"      |- C [message]",
			"      `- D [message] <当前末端>",
		]);
	});

	it("resetLeaf 不删除旧 entry，下一次 append 会创建新的 root", async () => {
		const result = await runLesson({ output: { writeLine: () => undefined } });

		expect(result.contextAfterReset).toEqual(["E"]);
		expect(result.currentBranch).toEqual(["E"]);
		expect(result.treeAfterReset).toContain("E [message] <当前末端>");
		expect(result.treeAfterReset).toContain("      `- D [message]");
	});

	it("branch 不接受未知 entry，且不会改变现有 leaf", () => {
		const fixture = createSessionTreeFixture();
		const originalLeaf = fixture.session.getLeafId();

		expect(() => fixture.session.branch("missing-entry")).toThrow("Entry missing-entry not found");
		expect(fixture.session.getLeafId()).toBe(originalLeaf);
		expect(labelsForContext(fixture.session.buildSessionContext().messages)).toEqual(["A", "B", "D"]);
	});
});
