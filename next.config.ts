import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 지급 리스트 첨부파일(사업자등록증/통장사본)은 슬롯당 10MB까지 허용하므로
    // 두 슬롯을 한 번에 저장할 때(최대 20MB)를 감안해 기본 1MB 제한을 올린다.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
