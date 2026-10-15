import React, { useState } from 'react';

interface UserAvatarProps {
  name: string;
  avatarUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  avatarUrl,
  size = 'md',
  className = '',
}) => {
  const [hasError, setHasError] = useState(false);

  const sizeClasses = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm',
  }[size];

  // Generate 1-2 initials from the user's name
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U';

  if (!avatarUrl || hasError) {
    return (
      <div
        className={`${sizeClasses} rounded-full bg-gradient-to-tr from-primary to-secondary text-on-primary font-bold flex items-center justify-center shadow-sm select-none shrink-0 tracking-wider border border-white/20 ${className}`}
        title={name}
      >
        <span>{initials}</span>
      </div>
    );
  }

  return (
    <img
      src={avatarUrl}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`${sizeClasses} rounded-full object-cover shrink-0 border border-outline-variant/30 ${className}`}
      title={name}
    />
  );
};
