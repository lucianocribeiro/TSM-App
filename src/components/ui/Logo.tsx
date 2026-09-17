import Image from "next/image";

export type LogoProps = {
  alt: string;
  size?: number;
  preload?: boolean;
};

// TSM logo from public/logotsm.png (182x176). Rendered unmodified.
export function Logo({ alt, size = 72, preload = false }: LogoProps) {
  return (
    <Image
      src="/logotsm.png"
      alt={alt}
      width={size}
      height={Math.round((size * 176) / 182)}
      preload={preload}
    />
  );
}
