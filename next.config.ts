import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 디렉터리의 lockfile 때문에 workspace root 오추론되는 것 방지
  turbopack: { root: import.meta.dirname },
  // Prisma & bcrypt must stay external to the server bundle (Turbopack).
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // 옛 '일반 발주 관리' 주소 → 발주 시스템 관리(2026-10-16 합침).
  // 페이지 안 redirect() 는 (admin) loading 스트리밍 뒤라 브라우저 라우터 오류를 남겨서 여기서 바로 보낸다.
  async redirects() {
    return [{ source: "/admin/order-config", destination: "/admin/order-plan", permanent: false }];
  },
};

export default nextConfig;
