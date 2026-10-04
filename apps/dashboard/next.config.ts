import { join } from "node:path"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	output: "standalone",
	// Monorepo root, so the standalone bundle includes hoisted dependencies
	outputFileTracingRoot: join(import.meta.dirname, "../.."),
	// The node installer served at /install.sh lives outside the app
	outputFileTracingIncludes: { "/install.sh": ["../../infra/node/install.sh"] },
}

export default nextConfig
