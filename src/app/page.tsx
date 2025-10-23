'use client';

import { useEffect, useState } from 'react';
import './homepage.css';

interface TrailDot {
  id: number;
  x: number;
  y: number;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

export default function Home() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const [trailDots, setTrailDots] = useState<TrailDot[]>([]);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    setMounted(true);
    let dotId = 0;
    let rippleId = 0;

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate position relative to center, normalized to -1 to 1
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      setMousePosition({ x, y });

      // Add trail dot (throttle to every few pixels)
      if (Math.random() > 0.7) {
        const newDot: TrailDot = {
          id: dotId++,
          x: e.clientX,
          y: e.clientY,
        };
        setTrailDots(prev => [...prev, newDot]);

        // Remove dot after animation
        setTimeout(() => {
          setTrailDots(prev => prev.filter(dot => dot.id !== newDot.id));
        }, 800);
      }
    };

    const handleClick = (e: MouseEvent) => {
      const newRipple: Ripple = {
        id: rippleId++,
        x: e.clientX,
        y: e.clientY,
      };
      setRipples(prev => [...prev, newRipple]);

      // Remove ripple after animation
      setTimeout(() => {
        setRipples(prev => prev.filter(ripple => ripple.id !== newRipple.id));
      }, 1000);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick);
    };
  }, []);

  return (
    <div className="homepage-container">
      {/* Cursor trail dots */}
      {trailDots.map(dot => (
        <div
          key={dot.id}
          className="trail-dot"
          style={{
            left: `${dot.x}px`,
            top: `${dot.y}px`,
          }}
        />
      ))}

      {/* Click ripples */}
      {ripples.map(ripple => (
        <div
          key={ripple.id}
          className="ripple"
          style={{
            left: `${ripple.x}px`,
            top: `${ripple.y}px`,
          }}
        />
      ))}

      {/* Main diamond with effects */}
      <div
        className={`diamond-wrapper ${mounted ? 'visible' : ''}`}
        style={{
          transform: `translate(${mousePosition.x * 20}px, ${mousePosition.y * 20}px)`,
        }}
      >
        {/* Main diamond image */}
        <img
          src="/20250914_diamond.png"
          alt="Diamond"
          className="diamond-image"
        />

        {/* Sparkle effects */}
        <div className="sparkle sparkle-1" />
        <div className="sparkle sparkle-2" />
        <div className="sparkle sparkle-3" />
        <div className="sparkle sparkle-4" />
      </div>
    </div>
  );
}
