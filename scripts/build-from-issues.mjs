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
    }
  } catch (e) {
    console.warn(`Error processing #${issue.number}:`, e);
  }
}

if (!rows.length) {
  throw new Error("No valid shortlinks were generated. Check issue formats.");
}

// optional: index page
fs.writeFileSync(path.join(outDir, "index.html"), `<!doctype html>
<meta charset="utf-8"><title>Shortlinks</title>
<h1>Shortlinks</h1>
<ul>${rows.map(([s,u]) => `<li><a href="/${s}">/${s}</a> → ${u}</li>`).join("\n")}</ul>`);

// optional: machine map
fs.writeFileSync(path.join(outDir, "map.json"), JSON.stringify(Object.fromEntries(rows.map(([s,u]) => [s,u])), null, 2));

console.log("Built", rows.length, "redirects");
