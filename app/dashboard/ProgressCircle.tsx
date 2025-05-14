"use client";

import React from "react";

interface ProgressCircleProps {
  value: number; // Value between 0-100
  size?: number; // Size in pixels
  strokeWidth?: number; // Width of the circle's stroke
  showLabel?: boolean; // Whether to show the percentage label
  color?: string; // Optional color override
  trackColor?: string; // Optional track color override
}

export const ProgressCircle: React.FC<ProgressCircleProps> = ({
  value,
  size = 100,
  strokeWidth = 8,
  showLabel = true,
  color,
  trackColor,
}) => {
  // Ensure value is between 0 and 100
  const normalizedValue = Math.min(100, Math.max(0, value));
  
  // Calculate circle parameters
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (normalizedValue / 100) * circumference;
  
  // Center position
  const center = size / 2;
  
  // Default colors based on CSS variables
  const defaultColor = "hsl(var(--primary))";
  const defaultTrackColor = "hsl(var(--muted))";
  
  // Set text size based on circle size
  const fontSize = showLabel ? Math.max(size / 4, 12) : 0;

  return (
    <div 
      className="inline-flex items-center justify-center" 
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={normalizedValue}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
      >
        {/* Background track circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={trackColor || defaultTrackColor}
          strokeWidth={strokeWidth}
          className="opacity-30"
        />
        
        {/* Foreground progress circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color || defaultColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-500 ease-in-out"
        />
      </svg>
      
      {/* Percentage label */}
      {showLabel && (
        <div 
          className="absolute text-center font-medium" 
          style={{ fontSize: `${fontSize}px` }}
        >
          {Math.round(normalizedValue)}%
        </div>
      )}
    </div>
  );
};
