## go.dip.sh

URL shortener powered by a Cloudflare Worker with KV storage and a Bun-compiled CLI.

### Environment variables
- SHORTEN_BASE: Base URL of the deployed worker. Default: https://go.dip.sh
- SHORTEN_USER: Name recorded as the creator (fallbacks: $USER, then "cli").

### CLI
Build a single-file binary:

```sh
bun install
bun run build
```

Usage:

```sh
# Auto-generate slug
./shorten https://example.com

# Provide your own slug
./shorten https://example.com docs

# Interactive (no args)
./shorten

# Quiet mode (prints only the short URL)
./shorten https://example.com -q
```

Output (normal mode):

```
Created: https://go.dip.sh/abcdef12
QR SVG:  https://go.dip.sh/abcdef12.svg
```

### Worker
- Local dev:

```sh
bun run dev
```

- Deploy:

```sh
bun run deploy
```

### API
- POST /api/shortlinks
	- body: { by: string, dest: string, slug?: string }
	- returns: { slug: string }

- GET /:slug → 303 redirect to destination
- GET /:slug.svg → QR code as SVG

