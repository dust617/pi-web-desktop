import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { CONFIG_DIR_NAME, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { calendarAgeDays, findMemoryControlRisk, findMemorySecretRisk, isMemoryDateExpired } from "../../../scripts/memory-contract.mjs";

type MemoryType = "fact" | "decision" | "constraint" | "failure_pattern";

type Fact = {
	id: string;
	title: string;
	tags: string[];
	verified: string;
	ttlDays: number;
	type: MemoryType;
	priority: "normal" | "pinned";
	replaces?: string;
	source?: string;
	body: string;
};

type Observation = {
	ts: string;
	category: "tool_failure" | "config_change";
	summary: string;
};

const MAX_BRIEF_CHARS = 760;
const MAX_FACT_CHARS = 320;
const MAX_RECALL_FACTS = 5;
const MAX_FACTS_BYTES = 65_536;
const MAX_FACTS_LINES = 800;
const LOCK_TIMEOUT_MS = 8_000;

const TAG_ALIASES: Record<string, string[]> = {
	memory: ["memory", "context", "session"],
	model: ["model", "codex", "thinking"],
	network: ["network", "router", "openclash", "frpc", "vps", "openai"],
	pwa: ["pwa", "mobile", "sse"],
};

function isoDate(): string {
	return new Date().toISOString().slice(0, 10);
}

function timestamp(): string {
	return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function readText(file: string): string {
	try {
		return existsSync(file) ? readFileSync(file, "utf8") : "";
	} catch {
		return "";
	}
}

function compact(text: string, maxChars: number): string {
	const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
	if (maxChars <= 1) return "";
	return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function wrapMemoryBlock(tag: string, body: string, maxChars: number): string {
	const openTag = `<${tag}>`;
	const closeTag = `</${tag}>`;
	const innerBudget = Math.max(1, maxChars - openTag.length - closeTag.length - 2);
	return `${openTag}\n${compact(body, innerBudget)}\n${closeTag}`;
}

function findMemoryContentRisk(text: string): string | null {
	return findMemorySecretRisk(text) ?? findMemoryControlRisk(text);
}

function requireSafeMemoryText(text: string): void {
	const risk = findMemoryContentRisk(text);
	if (risk) {
		throw new Error(`拒绝保存：检测到 ${risk} 风险。记忆中只能记录安全位置、轮换状态或非敏感摘要。`);
	}
}

function requireSingleLine(name: string, text: string): void {
	if (/[\r\n]/.test(text)) throw new Error(`拒绝保存：${name} 必须是单行文本，不能包含换行。`);
}

function findMemoryReadRisk(files: Array<[string, string]>): { file: string; risk: string } | null {
	for (const [file, text] of files) {
		const risk = findMemoryContentRisk(text);
		if (risk) return { file, risk };
	}
	return null;
}

function blockedMemoryBody(issue: { file: string; risk: string }): string {
	return `⚠ 已阻止加载项目记忆：${issue.file} 检测到 ${issue.risk} 风险。请先运行 npm run memory:check 并安全清理；本次未输出任何记忆原文。`;
}

function normalizeTags(tags: string[] = []): string[] {
	const cleaned = tags.map((tag) => tag.trim().replace(/^#/, "").toLowerCase()).filter(Boolean);
	for (const tag of cleaned) {
		if (!/^[a-z0-9-]{1,32}$/.test(tag)) {
			throw new Error("标签只能使用 1–32 位小写英文、数字或连字符，例如 network、failure-pattern。");
		}
	}
	return [...new Set(cleaned)];
}

function expandTags(tags: string[]): string[] {
	return [...new Set(tags.flatMap((tag) => TAG_ALIASES[tag] ?? [tag]))];
}

function parseFacts(raw: string): Fact[] {
	const matches = [...raw.matchAll(/^## (F-\d+)\s*\|\s*(.+)$/gm)];
	return matches.map((match, index) => {
		const blockStart = (match.index ?? 0) + match[0].length;
		const blockEnd = index + 1 < matches.length ? (matches[index + 1].index ?? raw.length) : raw.length;
		const block = raw.slice(blockStart, blockEnd).trim();
		const titleAndTags = match[2].trim();
		const tags = [...titleAndTags.matchAll(/#([a-z0-9-]+)/gi)].map((tag) => tag[1].toLowerCase());
		const title = titleAndTags.replace(/\s*#[a-z0-9-]+/gi, "").trim();
		const verifiedMatch = block.match(/^> Verified: (\d{4}-\d{2}-\d{2}) \| TTL: (\d+)d$/m);
		const typedMeta = block.match(/^> Type: (fact|decision|constraint|failure_pattern) \| Priority: (normal|pinned)(?: \| Replaces: (F-\d+))?$/m);
		const sourceMatch = block.match(/^> Source: (.+)$/m);
		const body = block
			.split("\n")
			.filter((line) => !line.startsWith("> Verified:") && !line.startsWith("> Type:") && !line.startsWith("> Source:"))
			.join("\n")
			.trim();
		return {
			id: match[1],
			title,
			tags,
			verified: verifiedMatch?.[1] ?? "1970-01-01",
			ttlDays: Number(verifiedMatch?.[2] ?? 0),
			type: (typedMeta?.[1] as MemoryType | undefined) ?? "fact",
			priority: (typedMeta?.[2] as "normal" | "pinned" | undefined) ?? "normal",
			replaces: typedMeta?.[3],
			source: sourceMatch?.[1],
			body,
		};
	});
}

function currentFacts(facts: Fact[]): Fact[] {
	const superseded = new Set(facts.flatMap((fact) => fact.replaces ? [fact.replaces] : []));
	return facts.filter((fact) => !superseded.has(fact.id));
}

function isExpired(fact: Fact): boolean {
	return isMemoryDateExpired(fact.verified, fact.ttlDays);
}

function activeFacts(facts: Fact[]): Fact[] {
	return currentFacts(facts).filter((fact) => !isExpired(fact));
}

function renderFact(fact: Fact, maxChars = MAX_FACT_CHARS): string {
	const metadata = [
		`类型: ${fact.type}`,
		`验证: ${fact.verified}`,
		fact.source ? `来源: ${fact.source}` : "",
	].filter(Boolean).join(" | ");
	return compact(`- [${fact.id}] ${fact.title} (#${fact.tags.join(" #")})\n  ${metadata}\n  ${fact.body}`, maxChars);
}

function sectionBody(markdown: string, heading: string): string {
	const match = markdown.match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "m"));
	return match?.[1]?.trim() ?? "";
}

function statusWarning(status: string): string {
	const metadata = status.match(/^> Updated: \d{4}-\d{2}-\d{2} \| Verify-by: (\d{4}-\d{2}-\d{2})$/m);
	if (!metadata) return "⚠ STATUS 缺少有效复验期限，只能作为历史线索；先验证运行时状态。";
	if (isMemoryDateExpired(metadata[1], 0)) {
		return `⚠ STATUS 已超过复验期限 ${metadata[1]}，只能作为历史线索；先验证运行时状态。`;
	}
	return "";
}

function statusBrief(status: string, maxChars: number): string {
	const warning = statusWarning(status);
	const current = sectionBody(status, "当前状态");
	const actions = sectionBody(status, "Next Actions")
		.split("\n")
		.filter((line) => line.startsWith("- [ "))
		.slice(0, 3)
		.join("\n");
	return compact([warning, current, actions ? `待办:\n${actions}` : ""].filter(Boolean).join("\n"), maxChars);
}

function deriveTags(prompt: string): string[] {
	const lower = prompt.toLowerCase();
	const routes: Array<[string, string[]]> = [
		["network", ["网络", "路由", "vps", "frp", "代理", "dns", "openai"]],
		["model", ["模型", "codex", "gpt", "qwen", "thinking"]],
		["pwa", ["pwa", "mobile", "sse", "service worker"]],
		["memory", ["记忆", "memory", "会话", "压缩"]],
	];
	return routes.filter(([, keywords]) => keywords.some((keyword) => lower.includes(keyword))).map(([tag]) => tag);
}

function isSubstantivePrompt(prompt: string): boolean {
	const normalized = prompt.trim().toLowerCase().replace(/[\s!！?？,.，。~～]+/g, "");
	if (!normalized) return false;
	return !new Set(["你好", "您好", "哈喽", "嗨", "在吗", "早", "早上好", "晚上好", "hi", "hello", "hey"]).has(normalized);
}

function recentObservations(file: string): Observation[] {
	return readText(file).split(/\r?\n/).filter(Boolean).slice(-20).flatMap((line) => {
		try {
			const parsed = JSON.parse(line) as Observation;
			return parsed.summary ? [parsed] : [];
		} catch {
			return [];
		}
	});
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error: any) {
		return error?.code !== "ESRCH";
	}
}

async function canBreakLock(lockFile: string): Promise<boolean> {
	try {
		const raw = readText(lockFile);
		const owner = JSON.parse(raw) as { pid?: number };
		if (Number.isInteger(owner.pid)) return !isProcessRunning(owner.pid as number);
		const info = await stat(lockFile);
		return Date.now() - info.mtimeMs > 30_000;
	} catch {
		try {
			const info = await stat(lockFile);
			return Date.now() - info.mtimeMs > 30_000;
		} catch {
			return true;
		}
	}
}

async function withCrossProcessLock<T>(targetFile: string, action: () => Promise<T> | T): Promise<T> {
	const lockFile = `${targetFile}.lock`;
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	mkdirSync(dirname(targetFile), { recursive: true });
	let handle: Awaited<ReturnType<typeof open>> | undefined;

	while (!handle) {
		try {
			handle = await open(lockFile, "wx");
			await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
		} catch (error: any) {
			if (error?.code !== "EEXIST") throw error;
			if (await canBreakLock(lockFile)) {
				await unlink(lockFile).catch(() => undefined);
				continue;
			}
			if (Date.now() >= deadline) throw new Error(`记忆文件正被另一个会话写入：${targetFile}`);
			await new Promise((resolve) => setTimeout(resolve, 35 + Math.floor(Math.random() * 40)));
		}
	}

	try {
		return await action();
	} finally {
		await handle.close().catch(() => undefined);
		await unlink(lockFile).catch(() => undefined);
	}
}

function writeTextAtomically(file: string, text: string): void {
	mkdirSync(dirname(file), { recursive: true });
	const tempFile = `${file}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFileSync(tempFile, text, { encoding: "utf8", flag: "wx" });
		renameSync(tempFile, file);
	} finally {
		if (existsSync(tempFile)) unlinkSync(tempFile);
	}
}

function validateFactDocument(text: string): void {
	requireSafeMemoryText(text);
	const bytes = Buffer.byteLength(text, "utf8");
	const lines = text === "" ? 0 : text.split(/\r?\n/).length;
	if (bytes > MAX_FACTS_BYTES) throw new Error(`拒绝保存：FACTS.md 将达到 ${bytes}B，超过 ${MAX_FACTS_BYTES}B。请先合并或归档旧事实。`);
	if (lines > MAX_FACTS_LINES) throw new Error(`拒绝保存：FACTS.md 将达到 ${lines} 行，超过 ${MAX_FACTS_LINES} 行。请先合并或归档旧事实。`);

	const allHeadingCount = text.match(/^## /gm)?.length ?? 0;
	const headings = [...text.matchAll(/^## (F-\d+) \| [^\r\n]+$/gm)];
	const strictMetadata = [...text.matchAll(/^## (F-\d+) \| [^\r\n]+\r?\n> Verified: (\d{4}-\d{2}-\d{2}) \| TTL: (\d+)d\r?\n> Type: (fact|decision|constraint|failure_pattern) \| Priority: (normal|pinned)(?: \| Replaces: (F-\d+))?\r?\n> Source: [^\r\n]+$/gm)];
	if (allHeadingCount !== strictMetadata.length || headings.length !== strictMetadata.length) {
		throw new Error("拒绝保存：FACTS.md 存在不完整或顺序错误的事实元数据。");
	}

	const facts = parseFacts(text);
	const ids = facts.map((fact) => fact.id);
	const idSet = new Set(ids);
	if (idSet.size !== ids.length) throw new Error("拒绝保存：FACTS.md 已存在重复 Fact ID，请先修复。");
	const replaceTargets = new Map<string, string>();
	const replacedCounts = new Map<string, number>();
	for (const [index, heading] of headings.entries()) {
		const sectionStart = heading.index ?? 0;
		const sectionEnd = index + 1 < headings.length ? (headings[index + 1].index ?? text.length) : text.length;
		const section = text.slice(sectionStart, sectionEnd);
		if ((section.match(/^> Source: .+$/gm) ?? []).length !== 1) throw new Error(`拒绝保存：${heading[1]} 必须且只能包含一个 Source。`);
	}
	for (const fact of facts) {
		const ageDays = calendarAgeDays(fact.verified);
		if (!Number.isFinite(ageDays) || ageDays < 0) throw new Error(`拒绝保存：${fact.id} 的 Verified 日期无效或位于未来。`);
		if (fact.replaces) {
			if (!idSet.has(fact.replaces) || fact.replaces === fact.id) throw new Error(`拒绝保存：${fact.id} 的 Replaces 引用无效。`);
			replaceTargets.set(fact.id, fact.replaces);
			replacedCounts.set(fact.replaces, (replacedCounts.get(fact.replaces) ?? 0) + 1);
		}
	}
	for (const [id, count] of replacedCounts) {
		if (count > 1) throw new Error(`拒绝保存：${id} 被多个事实同时替代。`);
	}
	for (const id of ids) {
		const seen = new Set<string>();
		let cursor: string | undefined = id;
		while (cursor && replaceTargets.has(cursor)) {
			if (seen.has(cursor)) throw new Error("拒绝保存：FACTS.md 的 Replaces 关系存在循环。");
			seen.add(cursor);
			cursor = replaceTargets.get(cursor);
		}
	}
}

async function appendObservation(file: string, observation: Observation): Promise<void> {
	await withFileMutationQueue(file, () => withCrossProcessLock(file, async () => {
		const rawLines = readText(file).split(/\r?\n/).filter(Boolean);
		const previous = rawLines.slice(-20).flatMap((line) => {
			try { return [JSON.parse(line) as Observation]; } catch { return []; }
		});
		const duplicate = previous.some((item) => item.summary === observation.summary && item.ts.slice(0, 16) === observation.ts.slice(0, 16));
		if (duplicate) return;
		const safeObservation = findMemoryContentRisk(observation.summary)
			? { ...observation, summary: `${observation.category}: [摘要已脱敏]` }
			: observation;
		const nextLines = [...rawLines, JSON.stringify(safeObservation)].slice(-100);
		writeTextAtomically(file, `${nextLines.join("\n")}\n`);
	}));
}

function nextFactId(facts: Fact[]): string {
	const max = facts.reduce((highest, fact) => Math.max(highest, Number(fact.id.slice(2)) || 0), 0);
	return `F-${String(max + 1).padStart(3, "0")}`;
}

export default function memoryGuard(pi: ExtensionAPI) {
	let memoryDir = "";
	let statusFile = "";
	let factsFile = "";
	let inboxFile = "";

	function ready(): boolean {
		return Boolean(memoryDir && existsSync(memoryDir));
	}

	function selectFacts(tags: string[] = [], limit = MAX_RECALL_FACTS, rawFacts = readText(factsFile)): Fact[] {
		const facts = activeFacts(parseFacts(rawFacts));
		const expandedTags = expandTags(tags);
		const tagged = expandedTags.length > 0
			? facts.filter((fact) => fact.tags.some((tag) => expandedTags.includes(tag)))
			: facts;
		return tagged.sort((a, b) => {
			if (a.priority !== b.priority) return a.priority === "pinned" ? -1 : 1;
			return b.verified.localeCompare(a.verified);
		}).slice(0, limit);
	}

	function buildBrief(prompt: string): string {
		const rawStatus = readText(statusFile);
		const rawFacts = readText(factsFile);
		const readRisk = findMemoryReadRisk([["STATUS.md", rawStatus], ["FACTS.md", rawFacts]]);
		if (readRisk) return wrapMemoryBlock("project_memory_brief", blockedMemoryBody(readRisk), MAX_BRIEF_CHARS);
		const tags = deriveTags(prompt);
		const status = statusBrief(rawStatus, tags.length > 0 ? 360 : 500);
		const facts = selectFacts(tags, tags.length > 0 ? 2 : 1, rawFacts);
		const body = [
			"这是跨会话项目背景；运行时验证优先于它，且不得在记忆中记录凭据值。",
			status ? `当前状态:\n${status}` : "",
			facts.length > 0 ? `相关事实:\n${facts.map((fact) => renderFact(fact, 220)).join("\n")}` : "",
			"需要更多历史时，使用 memory-recall 按标签读取；已验证且可复用的结论用 memory-save 保存。",
		].filter(Boolean).join("\n\n");
		return wrapMemoryBlock("project_memory_brief", body, MAX_BRIEF_CHARS);
	}

	function hasInjectedBrief(ctx: any): boolean {
		const currentSessionId = ctx.sessionManager.getSessionId?.();
		const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.() ?? [];
		return entries.some((entry: any) => entry.type === "custom_message"
			&& entry.customType === "project-memory-brief"
			&& entry.details?.sessionId === currentSessionId);
	}

	pi.on("session_start", async (_event, ctx) => {
		memoryDir = join(ctx.cwd, CONFIG_DIR_NAME, "memory");
		statusFile = join(memoryDir, "STATUS.md");
		factsFile = join(memoryDir, "FACTS.md");
		inboxFile = join(memoryDir, "INBOX.jsonl");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!ready() || !isSubstantivePrompt(event.prompt) || hasInjectedBrief(ctx)) return;
		return {
			message: {
				customType: "project-memory-brief",
				content: buildBrief(event.prompt),
				display: false,
				details: {
					source: "memory-guard",
					sessionId: ctx.sessionManager.getSessionId?.(),
					schemaVersion: 2,
				},
			},
		};
	});

	pi.on("tool_result", async (event) => {
		if (!ready() || event.toolName.startsWith("memory-")) return;
		try {
			if (event.isError) {
				await appendObservation(inboxFile, { ts: timestamp(), category: "tool_failure", summary: `工具失败: ${event.toolName}` });
				return;
			}
			if ((event.toolName === "edit" || event.toolName === "write") && typeof (event.input as any).path === "string") {
				const path = String((event.input as any).path).replace(/\\/g, "/");
				if (/(^|\/)(AGENTS\.md|package\.json|\.pi\/)/i.test(path)) {
					await appendObservation(inboxFile, { ts: timestamp(), category: "config_change", summary: `关键配置修改: ${path}` });
				}
			}
		} catch {
			// Memory observation must never interrupt the primary tool flow.
		}
	});

	pi.registerTool({
		name: "memory-recall",
		label: "Memory Recall",
		description: "读取本项目跨会话记忆。无参数返回当前状态和少量有效事实；提供 tags 时只返回对应标签的有效事实。",
		promptSnippet: "Load concise project memory by tag when prior context matters",
		promptGuidelines: ["Use memory-recall for project history that is not already in the current context; prefer precise tags such as network, model, pwa, or memory."],
		parameters: Type.Object({
			tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 32 }), { maxItems: 8 })),
			maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
		}),
		async execute(_toolCallId, params) {
			if (!ready()) throw new Error("此项目未初始化记忆目录，无法加载项目记忆。");
			const rawStatus = readText(statusFile);
			const rawFacts = readText(factsFile);
			const readRisk = findMemoryReadRisk([["STATUS.md", rawStatus], ["FACTS.md", rawFacts]]);
			if (readRisk) {
				return {
					content: [{ type: "text", text: wrapMemoryBlock("project_memory_recall", blockedMemoryBody(readRisk), 2_400) }],
					details: { blocked: true, file: readRisk.file, risk: readRisk.risk, tags: [], factIds: [] },
				};
			}
			const tags = normalizeTags(params.tags ?? []);
			const facts = selectFacts(tags, params.maxItems ?? MAX_RECALL_FACTS, rawFacts);
			const status = statusBrief(rawStatus, tags.length > 0 ? 300 : 480);
			const body = [
				status ? `当前状态:\n${status}` : "",
				facts.length > 0 ? `有效事实${tags.length > 0 ? `（${tags.map((tag) => `#${tag}`).join(" ")}）` : ""}:\n${facts.map((fact) => renderFact(fact)).join("\n\n")}` : "没有匹配的有效事实。",
			].filter(Boolean).join("\n\n");
			return {
				content: [{ type: "text", text: wrapMemoryBlock("project_memory_recall", body, 2_400) }],
				details: { tags, factIds: facts.map((fact) => fact.id) },
			};
		},
	});

	pi.registerTool({
		name: "memory-save",
		label: "Memory Save",
		description: "把已验证、可复用的事实/决策/约束/失败模式保存到本项目 FACTS.md。不得传入任何凭据、Token、Cookie、私钥或认证 URL。",
		promptSnippet: "Save an important verified project fact without secrets",
		promptGuidelines: ["Use memory-save only for verified, reusable project knowledge. Never pass credential values, tokens, cookies, private keys, or authenticated URLs to memory-save."],
		parameters: Type.Object({
			fact: Type.String({ minLength: 12, maxLength: 1200, pattern: "^[^\\r\\n]+$", description: "脱离当前对话也能理解的单行已验证结论" }),
			tags: Type.Array(Type.String({ minLength: 1, maxLength: 32 }), { minItems: 1, maxItems: 8 }),
			type: StringEnum(["fact", "decision", "constraint", "failure_pattern"] as const),
			ttlDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
			priority: Type.Optional(StringEnum(["normal", "pinned"] as const)),
			source: Type.String({ minLength: 3, maxLength: 240, pattern: "^[^\\r\\n]+$", description: "安全的单行验证来源摘要，不含命令输出或密钥" }),
			replaces: Type.Optional(Type.String({ pattern: "^F-[0-9]{3,}$" })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ready()) throw new Error("此项目未初始化记忆目录，无法保存项目记忆。");
			requireSingleLine("fact", params.fact);
			requireSingleLine("source", params.source);
			requireSafeMemoryText([params.fact, params.source].join("\n"));
			const tags = normalizeTags(params.tags);
			const priority = params.priority ?? "normal";
			const ttlDays = params.ttlDays ?? (params.type === "constraint" ? 90 : 30);

			return withFileMutationQueue(factsFile, () => withCrossProcessLock(factsFile, async () => {
				const raw = readText(factsFile);
				const facts = parseFacts(raw);
				const ids = facts.map((fact) => fact.id);
				if (new Set(ids).size !== ids.length) throw new Error("FACTS.md 已存在重复 Fact ID，请先修复后再保存。");
				if (params.replaces && !currentFacts(facts).some((fact) => fact.id === params.replaces)) {
					throw new Error(`只能替代当前未被替代的事实；目标 ${params.replaces} 不存在或已被替代。`);
				}
				const id = nextFactId(facts);
				const title = compact(params.fact.replace(/\s+/g, " "), 56);
				const entry = [
					`## ${id} | ${title} ${tags.map((tag) => `#${tag}`).join(" ")}`,
					`> Verified: ${isoDate()} | TTL: ${ttlDays}d`,
					`> Type: ${params.type} | Priority: ${priority}${params.replaces ? ` | Replaces: ${params.replaces}` : ""}`,
					`> Source: ${params.source.trim()}`,
					`- ${params.fact.trim()}`,
				].join("\n");
				const base = raw.trimEnd() || "# 稳定事实";
				const next = `${base}\n\n${entry}\n`;
				validateFactDocument(next);
				writeTextAtomically(factsFile, next);
				return {
					content: [{ type: "text", text: `已保存 ${id}（${params.type}，${tags.map((tag) => `#${tag}`).join(" ")}）。` }],
					details: { id, tags, type: params.type, replaces: params.replaces, path: relative(ctx.cwd, factsFile) },
				};
			}));
		},
	});

	pi.registerTool({
		name: "memory-review",
		label: "Memory Review",
		description: "查看自动记录的低噪声候选观察。候选观察不会自动成为长期事实，需验证后再用 memory-save 保存。",
		parameters: Type.Object({}),
		async execute() {
			if (!ready()) throw new Error("此项目未初始化记忆目录，无法查看候选观察。");
			const rawInbox = readText(inboxFile);
			const readRisk = findMemoryReadRisk([["INBOX.jsonl", rawInbox]]);
			if (readRisk) {
				return {
					content: [{ type: "text", text: wrapMemoryBlock("project_memory_candidates", blockedMemoryBody(readRisk), 2_400) }],
					details: { blocked: true, file: readRisk.file, risk: readRisk.risk, count: 0 },
				};
			}
			const observations = recentObservations(inboxFile);
			const text = observations.length === 0
				? "没有待审核的候选观察。"
				: observations.map((item) => `- ${item.ts} | ${item.category} | ${item.summary}`).join("\n");
			return {
				content: [{ type: "text", text: wrapMemoryBlock("project_memory_candidates", text, 2_400) }],
				details: { count: observations.length },
			};
		},
	});

	pi.registerCommand("memory", {
		description: "显示本项目记忆状态",
		handler: async (_args, ctx) => {
			const parsed = parseFacts(readText(factsFile));
			const facts = activeFacts(parsed);
			const stale = currentFacts(parsed).filter(isExpired).length;
			const inbox = recentObservations(inboxFile).length;
			ctx.ui.notify(`Memory: ${facts.length} 条有效事实，${stale} 条待复核，${inbox} 条候选观察`, "info");
		},
	});
}
