// Minimal static server for the E2E fixtures, so the content script injects
// normally on a real http(s)-style page. No deps.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, extname, normalize } from "node:path";

const DIR = fileURLToPath(new URL("./fixtures", import.meta.url));
const PORT = Number(process.env.E2E_PORT || 5599);
const TYPES = {
  ".html": "text/html",
  ".webm": "video/webm",
  ".js": "text/javascript",
  ".css": "text/css",
};

createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent((req.url || "/").split("?")[0])).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  const file = join(DIR, rel === "/" ? "video.html" : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`e2e fixtures on http://localhost:${PORT}`));
