import React from 'react';

type BrandLogoVariant = 'lockup' | 'mark';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  className?: string;
  alt?: string;
}

const BRAND_ASSETS: Record<BrandLogoVariant, string> = {
  lockup: '/static/branding/mecha-one-logo.png',
  mark: '/static/branding/mecha-one-mark.png',
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'lockup',
  className = '',
  alt = 'MECHA.ONE',
}) => (
  <img
    src={BRAND_ASSETS[variant]}
    alt={alt}
    className={`block shrink-0 object-contain select-none ${className}`}
    draggable={false}
  />
);

export default BrandLogo;
