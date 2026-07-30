import React from 'react';

type BrandLogoVariant = 'lockup' | 'mark';
type BrandLogoTone = 'light' | 'dark';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  tone?: BrandLogoTone;
  className?: string;
  alt?: string;
}

const BRAND_ASSETS: Record<BrandLogoTone, Record<BrandLogoVariant, string>> = {
  light: {
    lockup: '/static/branding/spti-ai-logo-light.png',
    mark: '/static/branding/spti-ai-mark.png',
  },
  dark: {
    lockup: '/static/branding/spti-ai-logo-dark.png',
    mark: '/static/branding/spti-ai-mark.png',
  },
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'lockup',
  tone = 'light',
  className = '',
  alt = 'SPTI.AI',
}) => (
  <img
    src={BRAND_ASSETS[tone][variant]}
    alt={alt}
    className={`block shrink-0 object-contain select-none ${className}`}
    draggable={false}
  />
);

export default BrandLogo;
