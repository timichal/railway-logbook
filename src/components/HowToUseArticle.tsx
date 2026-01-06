'use client';

import React from 'react';

interface HowToUseArticleProps {
  onClose: () => void;
}

export default function HowToUseArticle({ onClose }: HowToUseArticleProps) {
  return (
    <div className="p-6">
      {/* Header with close button */}
      <div className="flex justify-between items-center mb-6 border-b border-gray-200 pb-4">
        <h2 className="text-2xl font-bold text-gray-900">How To Use</h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 text-2xl font-bold w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100"
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Empty content area - will be filled by user */}
      <div className="text-gray-700">
        {/* Content goes here */}
      </div>
    </div>
  );
}
