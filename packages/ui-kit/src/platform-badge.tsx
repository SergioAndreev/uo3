export interface PlatformBadgeProps {
  label: string;
}

export function PlatformBadge({ label }: PlatformBadgeProps) {
  return <span data-testid="platform-badge">{label}</span>;
}
