/// <reference types="bun-types" />
import * as p from "@clack/prompts";

type CreateReq = { by: string; dest: string; slug?: string };
type CreateRes = { slug: string } | { error: string };

function isValidHttpUrl(u: string): boolean {
	try {
		const x = new URL(u);
		return x.protocol === "http:" || x.protocol === "https:";
	} catch {
		return false;
	}
}

function sanitizeBase(u: string): string {
	return String(u).replace(/\/$/, "");
}

function parseArgs(argv: string[]) {
	let quiet = false;
	const rest: string[] = [];
	for (const a of argv) {
		if (a === "-q" || a === "--quiet") quiet = true;
		else rest.push(a);
	}
	const url = rest[0];
	const slug = rest[1];
	return { quiet, url, slug } as const;
}

function printResult(baseUrl: string, slug: string, quiet: boolean) {
	const link = `${baseUrl}/${slug}`;
	if (quiet) {
		console.log(link);
		return;
	}
	p.note(`Shortlink: ${link}\nQR Code: ${link}.svg`, `Created shortcode ${slug}`);
}

async function createShortlink(base: string, by: string, dest: string, slug?: string) {
	const body: CreateReq = slug ? { by, dest, slug } : { by, dest };
	const res = await fetch(new URL("/api/shortlinks", base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	let data: CreateRes;
	try { data = JSON.parse(text); } catch { data = { error: text } as any; }
	if (!res.ok) throw new Error((data as any).error || res.statusText);
	return (data as any).slug as string;
}

async function main() {
	const args = Bun.argv.slice(2);
	const { quiet, url, slug } = parseArgs(args);

	const base = Bun.env.SHORTEN_BASE || "https://go.dip.sh";
	const by = Bun.env.SHORTEN_USER || Bun.env.USER || "cli";

	let dest = url;
	let chosenSlug = slug;

	if (!dest) {
		p.intro("Create a shortlink");
		const urlAns = await p.text({
			message: "Destination URL",
			placeholder: "https://example.com",
			validate(v) {
				if (!v || typeof v !== "string") return "Please enter a URL";
				if (!isValidHttpUrl(v)) return "Enter a valid http(s) URL";
				return;
			},
		});
		if (p.isCancel(urlAns)) return p.cancel("Cancelled");
		dest = urlAns as string;

		const slugAns = await p.text({
			message: "Custom slug (optional)",
			placeholder: "leave blank for auto-generated",
			validate(v) {
				if (!v) return;
				if (/[\s/#?]/.test(v)) return "Slug cannot contain spaces, /, #, or ?";
				if (String(v).length > 128) return "Slug too long (max 128)";
				return;
			},
		});
		if (p.isCancel(slugAns)) return p.cancel("Cancelled");
		chosenSlug = (slugAns as string) || undefined;
	}

	if (!dest || !isValidHttpUrl(dest)) {
		console.error("Usage: shorten <url> [slug]\nTip: run without args for interactive mode.");
		process.exit(1);
	}

	const baseUrl = sanitizeBase(base);

	if (!quiet) p.spinner();
	const s = await createShortlink(baseUrl, by, dest, chosenSlug).catch((e) => {
		if (!quiet) p.log.error(String(e.message || e));
		else console.error(String(e.message || e));
		process.exit(2);
	});
	// Type guard for TS
	const slugOut = String(s);
	printResult(baseUrl, slugOut, quiet);
	if (!quiet) p.outro("Done");
}

main();
