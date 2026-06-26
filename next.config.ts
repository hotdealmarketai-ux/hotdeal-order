import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 디렉터리의 lockfile 때문에 workspace root 오추론되는 것 방지
  turbopack: { root: import.meta.dirname },
  // Prisma & bcrypt must stay external to the server bundle (Turbopack).
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default nextConfig;
