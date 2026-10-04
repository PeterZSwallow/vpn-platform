import { join } from "node:path"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	output: "standalone",
	// Monorepo root, so the standalone bundle includes hoisted dependencies
	outputFileTracingRoot: join(import.meta.dirname, "../.."),
}

export default nextConfig
