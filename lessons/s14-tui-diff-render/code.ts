import { pathToFileURL } from "node:url";
import { type Component, Container, type Terminal, TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const RENDER_SETTLE_MS = 30;
const SYNCHRONIZED_OUTPUT_START = "\x1b[?2026h";

export class TaskStatusComponent implements Component {
	private readonly task: string;
	private status: string;

	constructor(task: string, status: string) {
		this.task = task;
		this.status = status;
	}

	setStatus(status: string): void {
		this.status = status;
	}

	render(width: number): string[] {
		// 组件只声明当前应显示的两行；首帧和差分帧如何写入由 TUI 统一决定。
		return [truncateToWidth(`任务: ${this.task}`, width), truncateToWidth(`状态: ${this.status}`, width)];
	}

	invalidate(): void {}
}

// 用内存终端记录真实 TUI 写出的 ANSI 帧，不接管读者的 stdin 或屏幕。
export class RecordingTerminal implements Terminal {
	readonly writes: string[] = [];
	readonly kittyProtocolActive = false;
	readonly columns: number;
	readonly rows: number;

	constructor(columns: number, rows: number) {
		this.columns = columns;
		this.rows = rows;
	}

	get frameWrites(): string[] {
		return this.writes.filter((data) => data.includes(SYNCHRONIZED_OUTPUT_START));
	}

	start(_onInput: (data: string) => void, _onResize: () => void): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.writes.push(data);
	}
	moveBy(_lines: number): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(_title: string): void {}
	setProgress(_active: boolean): void {}
}

export interface DiffRenderObservation {
	columns: number;
	initialLines: string[];
	updatedLines: string[];
	initialVisibleWidths: number[];
	firstFrameWrite: string;
	diffFrameWrite: string;
	firstFrameContainsAllLines: boolean;
	diffContainsUnchangedTask: boolean;
	diffContainsUpdatedStatus: boolean;
	fullRedrawsAfterInitial: number;
	fullRedrawsAfterUpdate: number;
	sameFrameWriteCount: number;
}

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface RunLessonOptions {
	columns?: number;
	output?: LessonOutput;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
};

function yesOrNo(value: boolean): string {
	return value ? "是" : "否";
}

async function settleRender(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));
}

export async function observeTuiDiff(columns = 24): Promise<DiffRenderObservation> {
	// 准备阶段以 RecordingTerminal 隔离真实屏幕；核心渲染仍调用 Pi 公开的 TUI 和 Container。
	const terminal = new RecordingTerminal(columns, 8);
	const component = new TaskStatusComponent("分析代码", "等待");
	const layout = new Container();
	layout.addChild(component);

	// 不手写 ANSI 差分算法：让 Pi 的 TUI 产生真实帧，再从内存终端观察结果。
	const tui = new TUI(terminal);
	tui.addChild(layout);

	try {
		tui.start();
		// 渲染是异步调度的，等待一轮后首帧才已经写入 RecordingTerminal。
		await settleRender();

		const initialLines = component.render(columns);
		const firstFrameWrite = terminal.frameWrites[0] ?? "";
		const fullRedrawsAfterInitial = tui.fullRedraws;

		// 只改变第二行，并请求 Pi 重新比较新旧帧；未变化的任务行应无需重新写入。
		component.setStatus("完成");
		const updatedLines = component.render(columns);
		// 这次请求让 Pi 对比更新前后的虚拟帧，并只写入必要的终端差分。
		tui.requestRender();
		await settleRender();

		const diffFrameWrite = terminal.frameWrites[1] ?? "";
		const fullRedrawsAfterUpdate = tui.fullRedraws;
		const frameCountBeforeSameRender = terminal.frameWrites.length;

		// 相同的虚拟帧再次提交，检验 Pi 会跳过无变化的终端写入。
		tui.requestRender();
		await settleRender();

		return {
			columns,
			initialLines,
			updatedLines,
			initialVisibleWidths: initialLines.map(visibleWidth),
			firstFrameWrite,
			diffFrameWrite,
			firstFrameContainsAllLines: initialLines.every((line) => firstFrameWrite.includes(line)),
			diffContainsUnchangedTask: diffFrameWrite.includes(updatedLines[0] ?? ""),
			diffContainsUpdatedStatus: diffFrameWrite.includes(updatedLines[1] ?? ""),
			fullRedrawsAfterInitial,
			fullRedrawsAfterUpdate,
			sameFrameWriteCount: terminal.frameWrites.length - frameCountBeforeSameRender,
		};
	} finally {
		// 即使断言或渲染失败，也停止 TUI，归还终端生命周期。
		tui.stop();
	}
}

export async function runLesson(options: RunLessonOptions = {}): Promise<DiffRenderObservation> {
	const output = options.output ?? consoleOutput;
	const result = await observeTuiDiff(options.columns);

	output.writeLine("[步骤 1/3] 第一次渲染：没有旧帧，终端必须收到完整帧。");
	output.writeLine(`终端宽度: ${result.columns} 列`);
	output.writeLine(`首帧: ${result.initialLines.join(" | ")}`);
	output.writeLine(`首帧包含全部两行: ${yesOrNo(result.firstFrameContainsAllLines)}`);
	output.writeLine("[步骤 2/3] 状态只改变一行：终端只收到变化区间。");
	output.writeLine(`更新帧: ${result.updatedLines.join(" | ")}`);
	output.writeLine(`差分写入包含未变化任务行: ${yesOrNo(result.diffContainsUnchangedTask)}`);
	output.writeLine(`差分写入包含新状态行: ${yesOrNo(result.diffContainsUpdatedStatus)}`);
	output.writeLine(`全量重绘次数: ${result.fullRedrawsAfterInitial} -> ${result.fullRedrawsAfterUpdate}`);
	output.writeLine("[步骤 3/3] 再渲染相同状态：没有变化就不写入终端。");
	output.writeLine(`相同帧新增写入: ${result.sameFrameWriteCount}`);
	output.writeLine(`首帧可见宽度: ${result.initialVisibleWidths.join(", ")}（上限 ${result.columns}）`);

	return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
