import { getAvatarPublicUrl } from "@/lib/api";

interface AvatarProps {
  src: string | null | undefined;
  name: string;
  size?: "sm" | "md" | "lg";
}

const sizeClass = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-16 text-xl" } as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}

export function Avatar({ src, name, size = "md" }: AvatarProps) {
  const url = getAvatarPublicUrl(src);
  const cls = sizeClass[size];
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={`${cls} shrink-0 rounded-full object-cover ring-1 ring-line`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${cls} flex shrink-0 items-center justify-center rounded-full bg-brand-deep font-bold text-white ring-1 ring-line`}
    >
      {initials(name)}
    </span>
  );
}
