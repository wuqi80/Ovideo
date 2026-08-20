import React from 'react';
import { BRAND_NAME } from '../config/brand';

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
    lockup: '/static/branding/ostory-tv-logo-on-light.svg?v=20260820-ostory-v1',
    mark: '/static/branding/ostory-tv-mark.svg?v=20260820-ostory-v1',
  },
  dark: {
    lockup: '/static/branding/ostory-tv-logo-on-dark.svg?v=20260820-ostory-v1',
    mark: '/static/branding/ostory-tv-mark.svg?v=20260820-ostory-v1',
  },
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'lockup',
  tone = 'light',
  className = '',
  alt = BRAND_NAME,
}) => (
  <img
    src={BRAND_ASSETS[tone][variant]}
    alt={alt}
    className={`block shrink-0 object-contain select-none ${className}`}
    draggable={false}
  />
);

export default BrandLogo;
