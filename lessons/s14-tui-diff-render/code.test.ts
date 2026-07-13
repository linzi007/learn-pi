import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { type DiffRenderObservation, runLesson, TaskStatusComponent } from "./code.ts";

describe("s14 TUI diff render", () => {
	let result: DiffRenderObservation;

	beforeAll(async () => {
		result = await runLesson({ output: { writeLine: () => undefined } });
	});

	it("首帧执行一次全量渲染并写入所有组件行", () => {
		expect(result.initialLines).toEqual(["任务: 分析代码", "状态: 等待"]);
		expect(result.firstFrameContainsAllLines).toBe(true);
		expect(result.firstFrameWrite).toContain("任务: 分析代码");
		expect(result.firstFrameWrite).toContain("状态: 等待");
		expect(result.fullRedrawsAfterInitial).toBe(1);
	});

	it("只有状态行变化时不重新写入未变化的任务行", () => {
		expect(result.updatedLines).toEqual(["任务: 分析代码", "状态: 完成"]);
		expect(result.diffContainsUnchangedTask).toBe(false);
		expect(result.diffContainsUpdatedStatus).toBe(true);
		expect(result.diffFrameWrite).not.toContain("任务: 分析代码");
		expect(result.diffFrameWrite).toContain("状态: 完成");
		expect(result.fullRedrawsAfterUpdate).toBe(result.fullRedrawsAfterInitial);
	});

	it("前后两帧相同时不产生新的终端帧写入", () => {
		expect(result.sameFrameWriteCount).toBe(0);
	});

	it("中文按终端列宽计算，并在边界内完整截断", () => {
		const width = 12;
		const component = new TaskStatusComponent("分析一份很长的中文项目", "等待");
		const lines = component.render(width);

		expect(visibleWidth("中文")).toBe(4);
		expect(lines[0]).toContain("...");
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
	});
});
