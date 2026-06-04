import { useState, useEffect } from 'react';
import '../styles/celebration.css';

// Soft, elegant colors — champagne, gold, blush, white, lavender
const COLORS = [
  '#d4af37', '#f5e6a3', '#ffd1dc', '#f8f0e3',
  '#e8d5f5', '#fff9e6', '#f7c5d0', '#e6d5b8',
];

const SHAPES = ['petal', 'circle', 'star'];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function generatePetals(count = 24) {
  return Array.from({ length: count }, (_, i) => ({
    id:       i,
    left:     rand(2, 98),
    delay:    rand(0, 1.6),
    duration: rand(2.8, 4.2),
    size:     rand(7, 14),
    color:    COLORS[Math.floor(Math.random() * COLORS.length)],
    drift:    rand(-55, 55),
    shape:    SHAPES[Math.floor(Math.random() * SHAPES.length)],
    opacity:  rand(0.65, 0.95),
  }));
}

export default function CelebrationEffect({ onDone }) {
  const [petals] = useState(() => generatePetals(24));

  useEffect(() => {
    const t = setTimeout(() => onDone?.(), 4500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="celebration-overlay" aria-hidden="true">
      {petals.map(p => (
        <div
          key={p.id}
          className={`celebration-petal celebration-petal--${p.shape}`}
          style={{
            left:              `${p.left}%`,
            width:             `${p.size}px`,
            height:            p.shape === 'star' ? `${p.size}px` : `${p.size * 1.5}px`,
            background:        p.color,
            opacity:           0,
            animationDelay:    `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--drift':         `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
