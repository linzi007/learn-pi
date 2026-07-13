import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const lessonsRoot = join(root, "lessons");
const requiredFiles = ["README.md", "code.ts", "code.test.ts"];
const errors: string[] = [];

function lessonDirectories() {
	return readdirSync(lessonsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^s\d{2}-/.test(entry.name))
		.map((entry) => join(lessonsRoot, entry.name))
		.sort();
}

function checkLesson(lessonDirectory: string) {
	const lessonName = relative(lessonsRoot, lessonDirectory);
	for (const fileName of requiredFiles) {
		if (!existsSync(join(lessonDirectory, fileName))) {
			errors.push(`${lessonName} 缺少 ${fileName}`);
		}
	}

	const codePath = join(lessonDirectory, "code.ts");
	if (!existsSync(codePath)) return;

	const sourceText = readFileSync(codePath, "utf8");
	const lineCount = sourceText.split(/\r?\n/).length;
	if (lineCount > 250) {
		errors.push(`${lessonName}/code.ts 有 ${lineCount} 行，超过 250 行硬上限`);
	}

	const sourceFile = ts.createSourceFile(codePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const specifier = statement.moduleSpecifier.text;
		if (!specifier.startsWith(".")) continue;

		const importedPath = resolve(dirname(codePath), specifier);
		if (importedPath.startsWith(lessonsRoot) && !importedPath.startsWith(lessonDirectory)) {
			errors.push(`${lessonName}/code.ts 不得导入其他课程: ${specifier}`);
		}
	}

	const readmePath = join(lessonDirectory, "README.md");
	if (existsSync(readmePath)) {
		const readme = readFileSync(readmePath, "utf8");
		for (const heading of [
			"## 问题",
			"## 解决方案",
			"## 工作原理",
			"## 试一下",
			"## 接下来",
			"<summary>深入 Pi 源码</summary>",
		]) {
			if (!readme.includes(heading)) errors.push(`${lessonName}/README.md 缺少“${heading}”`);
		}
		const imageReferences = [...readme.matchAll(/!\[[^\]]+\]\((images\/[^)]+\.svg)\)/g)];
		if (imageReferences.length === 0) {
			errors.push(`${lessonName}/README.md 缺少课程 images/ 下的 SVG 教学图`);
		}
		for (const reference of imageReferences) {
			const imagePath = reference[1];
			if (imagePath && !existsSync(join(lessonDirectory, imagePath))) {
				errors.push(`${lessonName}/README.md 引用了不存在的图片: ${imagePath}`);
			}
		}
		checkLocalMarkdownLinks(readmePath, readme);
	}
}

function checkLocalMarkdownLinks(markdownPath: string, markdown: string) {
	for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
		const rawTarget = match[1]?.trim();
		if (!rawTarget || rawTarget.startsWith("#") || /^(https?:|mailto:)/.test(rawTarget)) continue;

		const target = rawTarget.split("#", 1)[0]?.split("?", 1)[0];
		if (!target) continue;
		if (!existsSync(resolve(dirname(markdownPath), target))) {
			errors.push(`${relative(root, markdownPath)} 引用了不存在的本地路径: ${rawTarget}`);
		}
	}
}

function walkTypeScriptFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...walkTypeScriptFiles(entryPath));
		else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(entryPath);
	}
	return files;
}

function checkLegacyEntrypoints() {
	for (const lessonDirectory of lessonDirectories()) {
		const lessonName = relative(lessonsRoot, lessonDirectory);
		for (const legacyName of ["demo.ts", "demo.test.ts", "real-demo.ts", "real-runtime.ts"]) {
			if (existsSync(join(lessonDirectory, legacyName))) {
				errors.push(`${lessonName} 仍保留旧入口 ${legacyName}；课程只使用 code.ts 与 code.test.ts`);
			}
		}
	}
}

function checkExactSourceCopies() {
	const seen = new Map<string, string>();
	const sourceRoot = join(root, "src");
	const sourceFiles = existsSync(sourceRoot) ? walkTypeScriptFiles(sourceRoot) : [];
	const lessonEntrypoints = lessonDirectories().map((lessonDirectory) => join(lessonDirectory, "code.ts"));

	for (const filePath of [...sourceFiles, ...lessonEntrypoints].filter(existsSync).sort()) {
		const fileName = relative(root, filePath);
		const source = readFileSync(filePath, "utf8").replaceAll(/\s+/g, "");
		const hash = createHash("sha256").update(source).digest("hex");
		const previousFileName = seen.get(hash);
		if (previousFileName) errors.push(`${fileName} 与 ${previousFileName} 完全重复，请抽取共享实现`);
		seen.set(hash, fileName);
	}
}

function checkRootNavigation() {
	const rootReadmePath = join(root, "README.md");
	if (!existsSync(rootReadmePath)) return;

	const rootReadme = readFileSync(rootReadmePath, "utf8");
	checkLocalMarkdownLinks(rootReadmePath, rootReadme);
	for (const lessonDirectory of lessonDirectories()) {
		const target = relative(root, join(lessonDirectory, "README.md")).replaceAll("\\", "/");
		if (!rootReadme.includes(`](${target})`)) {
			errors.push(`README.md 未导航到已发布课程: ${target}`);
		}
	}
}

for (const lessonDirectory of lessonDirectories()) checkLesson(lessonDirectory);
checkLegacyEntrypoints();
checkExactSourceCopies();
checkRootNavigation();

if (errors.length > 0) {
	for (const error of errors) console.error(`- ${error}`);
	process.exitCode = 1;
} else {
	console.log(`课程结构检查通过，共 ${lessonDirectories().length} 课`);
}
