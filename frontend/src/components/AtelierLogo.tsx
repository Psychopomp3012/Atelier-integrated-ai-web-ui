import React from 'react';

interface AtelierLogoProps {
  className?: string;
  size?: number;
  withGlow?: boolean;
  variant?: 'auto' | 'color' | 'monochrome';
}

export const AtelierLogo: React.FC<AtelierLogoProps> = ({
  className = 'w-5 h-5',
  size = 24,
  withGlow = false,
  variant = 'auto',
}) => {
  const isColor = variant === 'color';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={`shrink-0 transition-colors duration-200 ${className}`}
      fill="none"
    >
      <defs>
        <linearGradient id="atelier-prism" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#06B6D4" />
          <stop offset="48%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id="atelier-facet" x1="8" y1="24" x2="24" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
        {withGlow && (
          <filter id="atelier-glow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        )}
      </defs>

      {withGlow && (
        <path
          d="M14.15 3.8a2.1 2.1 0 0 1 3.7 0l12 22.1A1.5 1.5 0 0 1 28.53 28H3.47a1.5 1.5 0 0 1-1.32-2.1z"
          fill={isColor ? 'url(#atelier-prism)' : 'currentColor'}
          className={!isColor ? 'text-slate-900 dark:text-white opacity-20' : 'opacity-35'}
          filter="url(#atelier-glow)"
        />
      )}

      {/* Outer Prism Shell */}
      <path
        fill={isColor ? 'url(#atelier-prism)' : undefined}
        className={!isColor ? 'fill-slate-900 dark:fill-white' : undefined}
        d="M14.15 3.8a2.1 2.1 0 0 1 3.7 0l12 22.1A1.5 1.5 0 0 1 28.53 28H3.47a1.5 1.5 0 0 1-1.32-2.1z"
      />

      {/* Inner Cutout Core */}
      <path
        fill={isColor ? '#0B1020' : undefined}
        className={!isColor ? 'fill-slate-100 dark:fill-[#090D16]' : undefined}
        d="M16 10.15 8.25 24.5h4.2L16 17.95l3.55 6.55h4.2z"
      />

      {/* Floating Center Facet */}
      <path
        fill={isColor ? 'url(#atelier-facet)' : undefined}
        className={!isColor ? 'fill-slate-800 dark:fill-slate-100' : undefined}
        d="M16 10.15 19.55 17H16l-2.1 3.9-2.1-3.9z"
        opacity="0.95"
      />

      {/* Accent Facet */}
      <path
        fill={isColor ? '#06B6D4' : undefined}
        className={!isColor ? 'fill-slate-500 dark:fill-slate-400' : undefined}
        d="M8.25 24.5h4.2l2.1-3.9-2.1-3.6z"
      />
    </svg>
  );
};
