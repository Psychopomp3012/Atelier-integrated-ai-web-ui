import React, { useState, useEffect } from 'react';

interface UserAvatarProps {
  name: string;
  avatarUrl?: string;
  size?: 'sm' | 'md' | 'lg' | 'header';
  className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  avatarUrl,
  size = 'md',
  className = '',
}) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [avatarUrl]);

  const sizeClasses = {
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-[26px] h-[26px] text-[11px]',
    lg: 'w-9 h-9 text-sm',
    header: 'w-full h-full md:w-[26px] md:h-[26px] text-xs md:text-[11px]',
  }[size];

  const borderClasses = size === 'header'
    ? 'border-0 md:border md:border-outline-variant/30'
    : 'border border-outline-variant/30';

  const fallbackBorderClasses = size === 'header'
    ? 'border-0 md:border md:border-white/20'
    : 'border border-white/20';

  // Generate 1-2 initials from the user's name
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U';

  const isPlaceholderUrl = !avatarUrl || avatarUrl.includes('ui-avatars.com');

  if (isPlaceholderUrl || hasError) {
    return (
      <div
        className={`${sizeClasses} rounded-full bg-gradient-to-tr from-primary to-secondary text-on-primary font-bold flex items-center justify-center shadow-sm select-none shrink-0 tracking-wider ${fallbackBorderClasses} ${className}`}
        title={name}
      >
        <span>{initials}</span>
      </div>
    );
  }

  return (
    <img
      src={avatarUrl}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`${sizeClasses} rounded-full object-cover shrink-0 ${borderClasses} ${className}`}
      title={name}
    />
  );
};
