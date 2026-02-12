import React from 'react';

export const FileNovaLogo = ({ className = "w-8 h-8", withText = false }: { className?: string, withText?: boolean }) => {
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                {/* Back Folder */}
                <path d="M10 30 C10 25 14 22 20 22 L40 22 L50 32 L85 32 C90 32 94 36 94 40 L94 80 C94 86 90 90 85 90 L15 90 C9 90 5 86 5 80 L5 30 L10 30 Z" 
                      fill="#0369a1" className="dark:fill-sky-800" />
                
                {/* Decoration: Network/Nodes (Green) */}
                <circle cx="50" cy="40" r="4" fill="#4ade80" />
                <circle cx="80" cy="20" r="4" fill="#4ade80" />
                <path d="M50 40 L80 20" stroke="#4ade80" strokeWidth="2" />
                <circle cx="20" cy="25" r="3" fill="#4ade80" />
                <path d="M20 25 L50 40" stroke="#4ade80" strokeWidth="2" />
                
                {/* Front Folder */}
                <path d="M5 50 C5 45 9 42 15 42 L90 42 C95 42 98 46 96 50 L86 85 C84 90 80 92 75 92 L15 92 C9 92 4 88 5 82 Z" 
                      fill="#0ea5e9" className="dark:fill-sky-500" />
                      
                {/* Lightning Bolt */}
                <path d="M60 15 L50 45 L65 45 L55 75" stroke="#ffffff" strokeWidth="0" fill="#bef264" transform="rotate(10 50 50)" />
            </svg>
            {withText && (
                <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">
                    File<span className="text-sky-500">Nova</span>
                </span>
            )}
        </div>
    );
};
