import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop `next dev` from writing a managed agent-rules block into CLAUDE.md / AGENTS.md.
  agentRules: false,
};

export default nextConfig;
