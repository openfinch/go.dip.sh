/// <reference types="bun-types" />
type CreateReq = { by: string; dest: string; slug?: string };
type CreateRes = { slug: string } | { error: string };

function usage(exitCode = 1): never {
	console.error("Usage: shorten <url> [slug]");
	process.exit(exitCode);
}

async function main() {
	const args = Bun.argv.slice(2);
	if (args.length < 1 || args.length > 2) usage(1);

	const dest = String(args[0]);
	const slug = args[1] ? String(args[1]) : undefined;

	const base = Bun.env.SHORTEN_BASE || "http://127.0.0.1:8787";
	const by = Bun.env.SHORT_BY || Bun.env.GIT_AUTHOR_NAME || Bun.env.USER || "cli";

	const body: CreateReq = slug ? { by, dest, slug } : { by, dest };

	const res = await fetch(new URL("/api/shortlinks", base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	const text = await res.text();
	let data: CreateRes;
	try { data = JSON.parse(text); } catch { data = { error: text } as any; }

	if (!res.ok) {
		console.error("Error:", (data as any).error || res.statusText);
		process.exit(2);
	}

	const s = (data as any).slug as string;
	console.log(s); // stdout: slug only
	const baseUrl = String(base).replace(/\/$/, "");
	console.error(`Created: ${baseUrl}/${s}`);
	console.error(`QR SVG:  ${baseUrl}/${s}.svg`);
}

main();
