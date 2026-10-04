import { readFile } from "node:fs/promises"
import { join } from "node:path"

// Serves infra/node/install.sh so nodes can be set up with
// `curl -fsSL https://<dashboard>/install.sh | sudo bash -s -- ...` while the
// repository stays private. The script is public; it contains no secrets.
// next.config.ts traces the file into the standalone build at the same
// relative location, so this path works in dev and in Docker.
const SCRIPT = join(process.cwd(), "../../infra/node/install.sh")

export async function GET() {
	const body = await readFile(SCRIPT, "utf8")
	return new Response(body, {
		headers: {
			"Content-Type": "text/x-shellscript; charset=utf-8",
			"Cache-Control": "no-store",
		},
	})
}
