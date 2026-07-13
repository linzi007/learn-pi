import { describe, expect, it } from "vitest";
import { resolveRuntimeMode, runLesson } from "./code.ts";

const tty = { stdinIsTTY: true, stdoutIsTTY: true };

describe("s13 Runtime Modes", () => {
	it("将四种输出方式路由为对应的 adapter 决策", async () => {
		const result = await runLesson({ writeLine: () => undefined });

		expect(result.decisions.map((decision) => decision.appMode)).toEqual([
			"interactive",
			"print",
			"json",
			"rpc",
			"print",
		]);
		expect(result.decisions[0]?.adapter).toBe("InteractiveMode");
		expect(result.decisions[1]?.adapter).toContain("runPrintMode");
		expect(result.decisions[2]?.adapter).toContain('mode: "json"');
		expect(result.decisions[3]?.adapter).toBe("runRpcMode");
	});

	it("使用公开 parseArgs 保留消息，并由 -p 选择文本输出", () => {
		const decision = resolveRuntimeMode(["-p", "总结当前项目"], tty);

		expect(decision.appMode).toBe("print");
		expect(decision.messages).toEqual(["总结当前项目"]);
		expect(decision.reason).toContain("--print/-p");
	});

	it("stdin 或 stdout 不是 TTY 时自动进入 print", () => {
		const pipedInput = resolveRuntimeMode([], { stdinIsTTY: false, stdoutIsTTY: true });
		const redirectedOutput = resolveRuntimeMode([], { stdinIsTTY: true, stdoutIsTTY: false });

		expect(pipedInput.appMode).toBe("print");
		expect(pipedInput.reason).toBe("stdin 不是 TTY");
		expect(redirectedOutput.appMode).toBe("print");
		expect(redirectedOutput.reason).toBe("stdout 不是 TTY");
	});

	it("显式 json 和 rpc 优先于非 TTY 与 -p", () => {
		const json = resolveRuntimeMode(["--mode", "json", "-p", "检查测试"], {
			stdinIsTTY: false,
			stdoutIsTTY: false,
		});
		const rpc = resolveRuntimeMode(["--mode", "rpc", "-p"], {
			stdinIsTTY: false,
			stdoutIsTTY: false,
		});

		expect(json.appMode).toBe("json");
		expect(rpc.appMode).toBe("rpc");
	});

	it("RPC 模式拒绝 @file 参数", () => {
		const decision = resolveRuntimeMode(["--mode", "rpc", "@prompt.md"], tty);

		expect(decision.fileArgs).toEqual(["prompt.md"]);
		expect(decision.diagnostics).toContain("Error: @file arguments are not supported in RPC mode");
	});

	it("--mode text 在真实 TTY 中仍保持 interactive", () => {
		const decision = resolveRuntimeMode(["--mode", "text", "继续工作"], tty);

		expect(decision.appMode).toBe("interactive");
		expect(decision.messages).toEqual(["继续工作"]);
	});
});
