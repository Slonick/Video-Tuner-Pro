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
  try {
    const rel = normalize(decodeURIComponent((req.url || "/").split("?")[0])).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    const file = join(DIR, rel === "/" ? "video.html" : rel);
    const body = await readFile(file);
    const type = TYPES[extname(file)] || "application/octet-stream";
    // Media elements seek via Range requests; a plain 200 leaves fixture videos unseekable.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && (range[1] || range[2])) {
      const size = body.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end) {
        res.writeHead(416, { "content-range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, {
        "content-type": type,
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": end - start + 1,
      });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { "content-type": type, "accept-ranges": "bytes" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`e2e fixtures on http://localhost:${PORT}`));
