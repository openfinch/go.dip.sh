## go.dip.sh

URL shortener powered by a Cloudflare Worker with KV storage and a Bun-compiled CLI.

### Prerequisites
- Bun (to build the CLI)
- Wrangler (installed via devDependencies)
- Cloudflare account with API token and account ID

### Environment variables
- SHORTEN_BASE: Base URL of the deployed worker. Default: https://go.dip.sh
- SHORTEN_USER: Name recorded as the creator (fallbacks: $USER, then "cli").
- CLOUDFLARE_API_TOKEN: Required in CI to deploy and manage KV.
- CLOUDFLARE_ACCOUNT_ID: Required in CI to deploy and manage KV.

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

