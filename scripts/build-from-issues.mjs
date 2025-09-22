import fs from "node:fs";
import path from "node:path";
import { Octokit } from "octokit";

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.GITHUB_REPOSITORY; // owner/name
const [owner, repo] = repoFull.split("/");

const outDir = "dist";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// fetch all open issues with label shortlink
const octokit = new Octokit({ auth: token });

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
  const body = (issue.body || "").trim();

  // 1) Try to parse "### Slug" / "### Destination URL" sections (case-insensitive)
  //    We grab the text after each heading up to the next heading or end.
  const section = (name) => {
    const re = new RegExp(
      String.raw`(^|\n)#{1,6}\s*${name}\s*\n+([\s\S]*?)(?=\n#{1,6}\s|\n*$)`,
      "i"
    );
    const m = body.match(re);
    if (!m) return undefined;
    // Clean block text: strip code fences, trim whitespace
    let text = m[2].trim();
    // If users put value in a code block, strip fences
    text = text.replace(/^```[^\n]*\n([\s\S]*?)\n```$/m, "$1").trim();
    // Collapse internal whitespace lines
    return text.split("\n").map(s => s.trim()).filter(Boolean).join(" ");
  };

  let slug = section("slug");
  let url  = section("destination url");

  // 2) Fallbacks:
  //    - Support inline "Slug:" / "Destination URL:" styles
  if (!slug) {
    const sm = body.match(/^\s*slug\s*:\s*([a-z0-9- ,]+)\s*$/mi);
    if (sm) slug = sm[1].trim();
  }
  if (!url) {
    const um = body.match(/^\s*destination url\s*:\s*(\S+)\s*$/mi);
    if (um) url = um[1].trim();
  }

  // 3) Final fallback to title/body scheme
  if (!slug) {
    slug = issue.title.trim().toLowerCase()
      .replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  if (!url) url = body;

  // Allow comma/space separated aliases in slug field: "docs, handbook"
  const slugs = String(slug)
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);

  return { slugs, url };
}


function isValidSlug(s) { return /^[a-z0-9-]+$/.test(s); }
function isValidUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol); } catch { return false; } }

function pageFor(dest) {
  const safe = String(dest).replace(/"/g, "&quot;");
  return `<!doctype html>
<meta charset="utf-8" />
<title>Redirecting…</title>
<meta http-equiv="refresh" content="0; url=${safe}">
<link rel="canonical" href="${safe}">
<script>location.replace(${JSON.stringify(dest)});</script>
<p>If you are not redirected, <a href="${safe}">click here</a>.</p>`;
}

const links = await fetchAllShortlinks();
const seen = new Set();
const rows = [];

for (const issue of links) {
  const { slug, url } = parseFromIssue(issue);
  if (!isValidSlug(slug) || !isValidUrl(url) || seen.has(slug)) continue;
  seen.add(slug);

  const dir = path.join(outDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), pageFor(url));

  rows.push([slug, url, issue.html_url]);
}

// optional: index page
fs.writeFileSync(path.join(outDir, "index.html"), `<!doctype html>
<meta charset="utf-8"><title>Shortlinks</title>
<h1>Shortlinks</h1>
<ul>${rows.map(([s,u]) => `<li><a href="/${s}">/${s}</a> → ${u}</li>`).join("\n")}</ul>`);

// optional: machine map
fs.writeFileSync(path.join(outDir, "map.json"), JSON.stringify(Object.fromEntries(rows.map(([s,u]) => [s,u])), null, 2));

console.log("Built", rows.length, "redirects");
