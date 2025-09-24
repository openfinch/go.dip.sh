import { encode, decode } from "@msgpack/msgpack";
import QRCode from "qrcode";
import { customAlphabet } from "nanoid";

const baseUrl = "https://go.dip.sh"

// Minimal KV typing to avoid external type deps
type KVGetValueType = "text" | "json" | "arrayBuffer" | undefined;
type KVNamespace = {
    get(key: string, type?: KVGetValueType): Promise<string | ArrayBuffer | null>;
    put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, opts?: { expiration?: number; expirationTtl?: number; metadata?: unknown }): Promise<void>;
    delete(key: string): Promise<void>;
};

interface Env { LINKS: KVNamespace }

interface Shortlink { by: string; dest: string }

const nanoid = customAlphabet("0123456789abcdef", 8);

function isValidHttpUrl(u: string): boolean {
    try {
        const x = new URL(u);
        return x.protocol === "http:" || x.protocol === "https:";
    } catch {
        return false;
    }
}

async function readJson<T = any>(req: Request): Promise<T | null> {
    try { return await req.json(); } catch { return null; }
}

function json(data: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(data), { ...init, headers });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const { pathname } = url;

        // Create shortlink: POST /api/shortlinks
        if (request.method === "POST" && pathname === "/api/shortlinks") {
            const body = await readJson<any>(request);
            if (!body) return json({ error: "Invalid JSON" }, { status: 400 });

            const by = (body.by ?? "").trim();
            const dest = (body.dest ?? "").trim();
            if (!by) return json({ error: "'by' is required" }, { status: 400 });
            if (!isValidHttpUrl(dest)) return json({ error: "'dest' must be http(s) URL" }, { status: 400 });

            // Optional requested slug (allow freetext path-safe); otherwise generate 8-hex
            let slug: string | undefined = (body.slug ?? "").trim() || undefined;
            if (slug) {
                // Allow path-safe freetext: disallow baseUrl, 303 and '#', no whitespace, limit length
                if (slug.length > 128 || /[\s/#?]/.test(slug)) return json({ error: "Invalid slug format" }, { status: 400 });
                const exists = await env.LINKS.get(slug);
                if (exists) return json({ error: "Slug already exists" }, { status: 409 });
            } else {
                const maxTries = 6;
                for (let i = 0; i < maxTries; i++) {
                    const candidate = nanoid();
                    const exists = await env.LINKS.get(candidate);
                    if (!exists) { slug = candidate; break; }
                }
                if (!slug) return json({ error: "Unable to generate unique slug" }, { status: 503 });
            }

            const blob: Shortlink = { by, dest };
            const packed = encode(blob) as Uint8Array;
            await env.LINKS.put(slug!, packed);
            return json({ slug }, { status: 201 });
        }

    // SVG QR: GET /:slug.svg (slug is any path-safe segment)
    const qrSvgMatch = pathname.match(/^\/([^\/]+)\.svg$/);
        if (request.method === "GET" && qrSvgMatch) {
            const slug = qrSvgMatch[1]!;
            const buf = (await env.LINKS.get(slug, "arrayBuffer")) as ArrayBuffer | null;
            if (!buf) return Response.redirect(baseUrl, 303);
            const obj = decode(new Uint8Array(buf)) as Shortlink;
            const target = `${url.origin}/${slug}`;
            const svg = await QRCode.toString(target, { type: "svg", width: 512, margin: 2, errorCorrectionLevel: "M" });
            return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8" } });
        }

    // Redirect: GET /:slug -> dest (slug is any path-safe segment)
    const goMatch = pathname.match(/^\/([^\/]+)$/);
        if (request.method === "GET" && goMatch) {
            const slug = goMatch[1]!;
            const buf = (await env.LINKS.get(slug, "arrayBuffer")) as ArrayBuffer | null;
            if (!buf) return Response.redirect(baseUrl, 303);
            const obj = decode(new Uint8Array(buf)) as Shortlink;
            return Response.redirect(obj.dest, 302);
        }

        // Root
        if (pathname === "/") {
            return Response.redirect("https://github.com/openfinch/go.dip.sh", 301);
        }

        return Response.redirect(baseUrl, 303);
    },
};