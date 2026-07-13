import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface LessonModule {
	runLesson?: () => Promise<unknown>;
}

function loadOptionalModelEnvironment(projectRoot: string) {
	const explicitPath = process.env.LEARN_PI_ENV_FILE;
	const candidates = [
		explicitPath ? resolve(process.cwd(), explicitPath) : undefined,
		join(projectRoot, ".env"),
		resolve(projectRoot, "..", "learn-claude-code", ".env"),
	].filter((path): path is string => path !== undefined);
	const environmentFile = candidates.find((path) => existsSync(path));

	if (environmentFile) process.loadEnvFile(environmentFile);
}

const lessonId = process.argv[2];

if (!lessonId) {
	console.error("缺少课程编号，例如：npm run lesson -- s01");
	process.exitCode = 1;
} else {
	const lessonsRoot = resolve(import.meta.dirname, "..", "lessons");
	const projectRoot = resolve(lessonsRoot, "..");
	const matches = readdirSync(lessonsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.startsWith(`${lessonId}-`))
		.map((entry) => entry.name);

	if (matches.length !== 1) {
		const available = readdirSync(lessonsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && /^s\d{2}-/.test(entry.name))
			.map((entry) => entry.name.slice(0, 3))
			.sort();

		console.error(`无法唯一定位课程: ${lessonId}`);
		console.error(`可用课程: ${available.join(", ") || "(暂无)"}`);
		process.exitCode = 1;
	} else {
		const lessonDirectory = matches.at(0);
		if (!lessonDirectory) {
			console.error(`无法读取课程目录: ${lessonId}`);
			process.exitCode = 1;
		} else {
			try {
				loadOptionalModelEnvironment(projectRoot);
			} catch {
				console.error("加载本地模型配置失败。请检查 LEARN_PI_ENV_FILE 或 .env 格式。");
				process.exitCode = 1;
			}

			if (process.exitCode !== 1) {
				const codePath = join(lessonsRoot, lessonDirectory, "code.ts");
				if (!existsSync(codePath)) {
					console.error(`${lessonDirectory}/code.ts 尚未提供`);
					process.exitCode = 1;
				} else {
					const lessonModule = (await import(pathToFileURL(codePath).href)) as LessonModule;

					if (typeof lessonModule.runLesson !== "function") {
						console.error(`${lessonDirectory}/code.ts 必须导出 async runLesson()`);
						process.exitCode = 1;
					} else {
						try {
							await lessonModule.runLesson();
						} catch {
							console.error("课程运行未完成。请检查本课 README 中的模型配置和运行前提。");
							process.exitCode = 1;
						}
					}
				}
			}
		}
	}
}
