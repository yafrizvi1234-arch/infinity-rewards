import React, { useEffect, useState } from 'react';

interface AvatarProps {
  src: string;
  alt: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  accent?: 'cyan' | 'purple' | 'blue' | 'none';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-20 w-20 text-xl',
};

const ACCENT_RING: Record<NonNullable<AvatarProps['accent']>, string> = {
  cyan: 'ring-2 ring-[#00F5FF] ring-offset-2 ring-offset-[#040713] shadow-[0_0_16px_rgba(0,245,255,0.5)]',
  purple: 'ring-2 ring-[#B84DFF] ring-offset-2 ring-offset-[#040713] shadow-[0_0_16px_rgba(184,77,255,0.55)]',
  blue: 'ring-2 ring-[#3B82F6] ring-offset-2 ring-offset-[#040713] shadow-[0_0_16px_rgba(59,130,246,0.55)]',
  none: 'border border-[#00F5FF]/25',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || 'IR';
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  size = 'md',
  accent = 'none',
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [src]);

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-blue-900/80 via-slate-900 to-purple-900/80 ${SIZE_CLASSES[size]} ${ACCENT_RING[accent]} ${className}`}
    >
      {!imgError && src ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-display font-bold text-cyan-200 select-none">
          {getInitials(alt)}
        </div>
      )}
    </div>
  );
};
