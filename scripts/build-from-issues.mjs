import fs from "node:fs";
import path from "node:path";
import { Octokit } from "octokit";
import QRCode from "qrcode";

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.GITHUB_REPOSITORY; // owner/name
const [owner, repo] = repoFull.split("/");

const outDir = "dist";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// fetch all open issues with label shortlink
const octokit = new Octokit({ auth: token });

function ensureTrailingSlash(u) { return u.endsWith("/") ? u : u + "/"; }

function inferBaseUrl(owner, repo) {
  const isRoot = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`;
  return isRoot
    ? `https://${owner}.github.io/`
    : `https://${owner}.github.io/${repo}/`;
}

const shortBase =
  process.env.SHORT_BASE_URL
    ? ensureTrailingSlash(process.env.SHORT_BASE_URL)
    : inferBaseUrl(owner, repo);

const qrMode = (process.env.QR_MODE || "short").toLowerCase(); // "short" | "dest"

async function fetchAllShortlinks() {
  const items = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.rest.issues.listForRepo({
      owner, repo, labels: "shortlink", state: "open", per_page: 100, page
    });
    items.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return items;
}

function parseFromIssue(issue) {
  const body = (issue.body ?? "").trim();

  // Extract text following a Markdown heading up to the next heading or EOF.
  const takeSection = (name) => {
    const re = new RegExp(
      String.raw`(?:^|\n)#{1,6}\s*${name}\s*\n+([\s\S]*?)(?=(?:\n#{1,6}\s)|\n*$)`,
      "i"
    );
    const m = body.match(re);
    if (!m) return undefined;

    let text = m[1].trim();

    // If wrapped in a code fence, strip it
    const fence = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/m);
    if (fence) text = fence[1].trim();

    // Collapse lines like:
    // docs\n\n\n  -> "docs"
    text = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");

    return text;
  };

  let slugField = takeSection("slug");
  let url = takeSection("destination url");

  // Fallback: inline "Slug:" and "Destination URL:" styles
  if (!slugField) {
    const sm = body.match(/^\s*slug\s*:\s*([a-z0-9- ,]+)\s*$/mi);
    if (sm) slugField = sm[1].trim();
  }
  if (!url) {
    const um = body.match(/^\s*destination url\s*:\s*(\S+)\s*$/mi);
    if (um) url = um[1].trim();
  }

  // Final fallback for slug: sanitize the title
  let fallbackTitleSlug = issue.title
    ? issue.title.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    : "";

  // Allow multiple slugs separated by spaces/commas/newlines
  const slugs = (slugField ?? fallbackTitleSlug)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return { slugs, url };
}

function isValidSlug(s) { return typeof s === "string" && /^[a-z0-9-]+$/.test(s); }
function isValidUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol); }
  catch { return false; }
}

async function fetchMeta(url) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    const pick = (re) => (html.match(re)?.[1] || "").trim();
    return {
      title: pick(/<title>([^<]{1,120})<\/title>/i),
      desc: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,200})["']/i),
      image: pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    };
  } catch { return {}; }
}

function pageFor(dest, slug, shortBase, meta = {}) {
  const safe = dest.replace(/"/g, "&quot;");
  const qr = `${shortBase}${slug}.png`;
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${meta.title || "Redirecting…"}</title>
<meta property="og:url" content="${shortBase}${slug}">
<meta property="og:title" content="${(meta.title || "Redirecting…").slice(0,120)}">
<meta property="og:description" content="${(meta.desc || "Short link").slice(0,200)}">
${meta.image ? `<meta property="og:image" content="${meta.image}">` : ""}
<link rel="canonical" href="${safe}">
<link rel="alternate" type="image/png" href="${qr}">
<meta http-equiv="refresh" content="0; url=${safe}">
<script>location.replace(${JSON.stringify(dest)} + location.search + location.hash);</script>
<p><a href="${safe}">Continue</a> • <a href="${qr}" download>QR</a></p>`;
}

const links = await fetchAllShortlinks();
const seen = new Set();
const rows = [];

for (const issue of links) {
  try {
    const { slugs, url } = parseFromIssue(issue);

    if (!url || !isValidUrl(url)) {
      console.warn(`Skipping #${issue.number}: invalid URL ->`, url);
      continue;
    }
    if (!slugs.length) {
      console.warn(`Skipping #${issue.number}: no slug(s) parsed`);
      continue;
    }

    for (const s of slugs) {
      if (!isValidSlug(s)) {
        console.warn(`Skipping slug "${s}" in #${issue.number}: invalid format`);
        continue;
      }
      if (seen.has(s)) {
        console.warn(`Duplicate slug "${s}" (first wins). Source issue: #${issue.number}`);
        continue;
      }
      seen.add(s);

      const dir = path.join(outDir, s);               // <- now guaranteed string
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "index.html"), pageFor(url));
      rows.push([s, url, issue.html_url]);
      
      const shortUrl = `${shortBase}${s}`;
      const qrTarget = qrMode === "dest" ? url : shortUrl;
      
      // Tweak size/margin/ECC as you like
      await QRCode.toFile(path.join(outDir, `${s}.png`), qrTarget, {
        width: 512,             // pixels
        margin: 2,              // quiet zone modules
        errorCorrectionLevel: "M"
      });
    }
  } catch (e) {
    console.warn(`Error processing #${issue.number}:`, e);
  }
}

if (!rows.length) {
  throw new Error("No valid shortlinks were generated. Check issue formats.");
}

fs.writeFileSync(path.join(outDir, "index.html"), `<!doctype html>
<meta charset="utf-8"><title>Shortlinks</title>
<style>
  body{font:16px/1.4 system-ui, sans-serif; max-width: 880px; margin: 2rem auto; padding: 0 1rem;}
  table{border-collapse: collapse; width: 100%;}
  th, td{border-bottom: 1px solid #ddd; padding: .5rem .4rem; vertical-align: middle;}
  img{display:block; width:64px; height:64px; image-rendering: pixelated;}
  code{background:#f6f8fa; padding:.1rem .3rem; border-radius:4px;}
</style>
<h1>Shortlinks</h1>
<table>
  <thead><tr><th>Slug</th><th>Destination</th><th>QR</th></tr></thead>
  <tbody>
    ${rows.map(([s,u]) => `
      <tr>
        <td><a href="/${s}">/${s}</a><br><code>${shortBase}${s}</code></td>
        <td><a href="${u}">${u}</a></td>
        <td><a href="${s}.png" download><img src="${s}.png" alt="QR for /${s}"></a></td>
      </tr>`).join("")}
  </tbody>
</table>`);

fs.writeFileSync(path.join(outDir, "map.json"), JSON.stringify(Object.fromEntries(rows.map(([s,u]) => [s,u])), null, 2));

console.log("Built", rows.length, "redirects");
