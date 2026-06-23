import React, { useEffect, useRef, useState } from 'react';

interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'loading' | 'decoding'> {
  src: string;
  rootMargin?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'sync' | 'async' | 'auto';
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  rootMargin = '300px',
  loading = 'lazy',
  decoding = 'async',
  ...props
}) => {
  const ref = useRef<HTMLImageElement | null>(null);
  const hasEnteredView = useRef(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    // 当 src 变化时，只在该图从未进入过视口的情况下重新进入懒加载等待。
    // 一旦图片已经显示过，就保持绑定：重新生成分镜后换上的新 URL 会原地替换，
    // 而不是先闪一帧空白再等 IntersectionObserver 重新触发。
    if (!hasEnteredView.current) {
      setInView(false);
    }
  }, [src]);

  useEffect(() => {
    const element = ref.current;
    if (!element || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      hasEnteredView.current = true;
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        hasEnteredView.current = true;
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return (
    <img
      {...props}
      ref={ref}
      src={inView ? src : undefined}
      loading={loading}
      decoding={decoding}
    />
  );
};

export default LazyImage;
