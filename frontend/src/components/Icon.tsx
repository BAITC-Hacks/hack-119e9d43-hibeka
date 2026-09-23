type IconName =
  | 'network'
  | 'upload'
  | 'download'
  | 'search'
  | 'info'
  | 'client'
  | 'layers'
  | 'refresh'
  | 'alert';
const paths: Record<IconName, string> = {
  network:
    'M8 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM22 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM14 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM8 6l8 2M6 8l4 8M17 11l-4 5',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',
  download: 'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 11v6m0-10v.1',
  client: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  layers: 'M12 3 2 8l10 5 10-5-10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
  refresh: 'M20 7a9 9 0 1 0 1 9M20 2v6h-6',
  alert: 'M12 3 1 21h22L12 3Zm0 6v5m0 3v.1',
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
