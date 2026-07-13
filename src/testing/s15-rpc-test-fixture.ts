import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentSessionEvent, RpcClient, type RpcSessionState } from "@earendil-works/pi-coding-agent";

const PROVIDER = "learn-pi-s15";
const MODEL = "learn-pi-s15";

export interface FauxRpcObservation {
	state: RpcSessionState;
	availableModels: Array<{ provider: string; id: string }>;
	eventTypes: AgentSessionEvent["type"][];
	finalText: string | null;
	missingModelError: string;
	stoppedRequestError: string;
	tempRootRemoved: boolean;
}

export async function runFauxRpcObservation(prompt: string): Promise<FauxRpcObservation> {
	const tempRoot = await mkdtemp(join(tmpdir(), "learn-pi-s15-test-"));

	let state: RpcSessionState;
	let availableModels: Array<{ provider: string; id: string }> = [];
	let eventTypes: AgentSessionEvent["type"][] = [];
	let finalText: string | null = null;
	let missingModelError = "";
	let stoppedRequestError = "";
	let client: RpcClient | undefined;

	try {
		const rpcEntryPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
		const extensionPath = fileURLToPath(new URL("./s15-faux-provider-extension.ts", import.meta.url));
		const nodePath = [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter);
		client = new RpcClient({
			cliPath: rpcEntryPath,
			cwd: tempRoot,
			model: `${PROVIDER}/${MODEL}`,
			env: {
				HOME: join(tempRoot, "home"),
				PATH: nodePath,
				PI_CODING_AGENT_DIR: join(tempRoot, "pi-agent"),
				PI_CONFIG_DIR: join(tempRoot, "pi-config"),
				PI_OFFLINE: "1",
			},
			args: [
				"--offline",
				"--no-session",
				"--no-tools",
				"--no-extensions",
				"--extension",
				extensionPath,
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				"--no-context-files",
				"--no-approve",
			],
		});

		await client.start();
		const [currentState, models] = await Promise.all([client.getState(), client.getAvailableModels()]);
		state = currentState;
		availableModels = models.map((model) => ({ provider: model.provider, id: model.id }));

		const events = await client.promptAndWait(prompt);
		eventTypes = events.map((event) => event.type);
		finalText = await client.getLastAssistantText();

		try {
			await client.setModel("missing-provider", "missing-model");
		} catch (error) {
			missingModelError = error instanceof Error ? error.message : String(error);
		}
	} finally {
		try {
			if (client) {
				await client.stop();
				try {
					await client.getState();
				} catch (error) {
					stoppedRequestError = error instanceof Error ? error.message : String(error);
				}
			}
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	}

	return {
		state,
		availableModels,
		eventTypes,
		finalText,
		missingModelError,
		stoppedRequestError,
		tempRootRemoved: !existsSync(tempRoot),
	};
}
