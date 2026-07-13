import { describe, expect, it } from "vitest";
import { runLesson } from "./code.ts";

describe("s11 extension runtime", () => {
	it("扩展接收生命周期事件，并在工具执行前阻止危险调用", async () => {
		const observation = await runLesson({ writeLine: () => undefined });

		expect(observation.loadedExtensionCount).toBe(1);
		expect(observation.eventTrace).toEqual(["agent_start", "tool_call:bash", "agent_end"]);
		expect(observation.blockReason).toBe("教学策略：禁止破坏性 bash 命令");
	});

	it("普通 extension handler 的异常被转换为诊断，运行仍能正常返回", async () => {
		const observation = await runLesson({ writeLine: () => undefined });

		expect(observation.diagnostics).toEqual([{ event: "agent_end", error: "教学扩展的故意失败" }]);
	});
});
