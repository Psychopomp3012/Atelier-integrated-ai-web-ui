import React from 'react';

interface AtelierLogoProps {
  className?: string;
  size?: number;
  withGlow?: boolean;
}

export const AtelierLogo: React.FC<AtelierLogoProps> = ({
  className = 'w-5 h-5',
  size = 24,
  withGlow = false,
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      fill="none"
    >
      <defs>
        {/* Crown Top Facet Gradient */}
        <linearGradient id="atelier-top-facet" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#818CF8" />
          <stop offset="50%" stop-color="#A78BFA" />
          <stop offset="100%" stop-color="#E0E7FF" />
        </linearGradient>

        {/* Left Wing Facet Gradient */}
        <linearGradient id="atelier-left-facet" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#6366F1" />
          <stop offset="100%" stop-color="#3730A3" />
        </linearGradient>

        {/* Right Wing Facet Gradient */}
        <linearGradient id="atelier-right-facet" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8B5CF6" />
          <stop offset="60%" stop-color="#6D28D9" />
          <stop offset="100%" stop-color="#312E81" />
        </linearGradient>

        {/* Central Craftsman Core Shard (Emerald to Cyan Glow) */}
        <linearGradient id="atelier-core-shard" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#38BDF8" />
          <stop offset="40%" stop-color="#10B981" />
          <stop offset="100%" stop-color="#34D399" />
        </linearGradient>

        {/* Optional Ambient Glow Filter */}
        <filter id="atelier-glow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Subtle Ambient Back-Glow */}
      {withGlow && (
        <path
          d="M16 2.5 L26.5 12.5 L16 29.5 L5.5 12.5 Z"
          fill="#818CF8"
          opacity="0.25"
          filter="url(#atelier-glow)"
        />
      )}

      {/* Top Facet (Diamond Crown) */}
      <polygon
        points="16,3 26.5,12 16,17 5.5,12"
        fill="url(#atelier-top-facet)"
      />

      {/* Left Lower Facet (Architectural Depth) */}
      <polygon
        points="5.5,12 16,17 16,29"
        fill="url(#atelier-left-facet)"
      />

      {/* Right Lower Facet */}
      <polygon
        points="26.5,12 16,17 16,29"
        fill="url(#atelier-right-facet)"
      />

      {/* Precision Facet Split Lines */}
      <line
        x1="16"
        y1="3"
        x2="16"
        y2="17"
        stroke="#FFFFFF"
        strokeOpacity="0.45"
        strokeWidth="0.8"
      />
      <line
        x1="5.5"
        y1="12"
        x2="26.5"
        y2="12"
        stroke="#FFFFFF"
        strokeOpacity="0.25"
        strokeWidth="0.6"
      />

      {/* Floating Center Core Jewel (Prism Focus) */}
      <polygon
        points="16,9.5 20.8,15.5 16,23 11.2,15.5"
        fill="url(#atelier-core-shard)"
      />
      <polygon
        points="16,9.5 16,23 11.2,15.5"
        fill="#FFFFFF"
        opacity="0.18"
      />
    </svg>
  );
};
