import { describe, expect, it } from "vitest";
import { runLesson } from "./demo.ts";

describe("s01 model stream", () => {
	it("亲眼展示多个 text_delta，并在结尾取得完整消息", async () => {
		let output = "";
		const result = await runLesson({
			output: {
				writeLine: (text) => {
					output += `${text}\n`;
				},
			},
		});

		expect(result.deltas).toEqual(["事件流会", "分段到达", "。"]);
		expect(result.finalText).toBe("事件流会分段到达。");
		expect(result.eventTypes).toEqual([
			"start",
			"text_start",
			"text_delta",
			"text_delta",
			"text_delta",
			"text_end",
			"done",
		]);
		expect(output).toContain("text_delta #1: 事件流会");
		expect(output).toContain("text_delta #2: 分段到达");
		expect(output).toContain("text_delta #3: 。");
		expect(output).toContain("最终消息: 事件流会分段到达。");
		expect(output).toContain("结束原因: stop");
		expect(result.message.provider).toBe("learn-pi-s01");
	});

	it("没有预设响应时通过 error 事件结束，而不是抛出 Promise 异常", async () => {
		const result = await runLesson({
			response: null,
			output: { writeLine: () => undefined },
		});

		expect(result.eventTypes).toEqual(["error"]);
		expect(result.deltas).toEqual([]);
		expect(result.finalText).toBe("");
		expect(result.message.stopReason).toBe("error");
		expect(result.message.errorMessage).toContain("No more faux responses queued");
	});
});
