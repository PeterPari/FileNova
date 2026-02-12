import React, { useEffect } from 'react';

interface ToastProps {
    message: string;
    type?: 'success' | 'error' | 'info';
    onClose: () => void;
    action?: {
        label: string;
        onClick: () => void;
    };
    duration?: number;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'info', onClose, action, duration = 5000 }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onClose]);

    const bgColors = {
        success: 'bg-green-600 border-green-500',
        error: 'bg-red-600 border-red-500',
        info: 'bg-blue-600 border-blue-500'
    };

    return (
        <div className={`fixed bottom-6 right-6 ${bgColors[type]} text-white px-4 py-3 rounded-lg shadow-xl border flex items-center gap-4 animate-slide-up z-50 max-w-sm`}>
            <span>{message}</span>
            {action && (
                <button
                    onClick={action.onClick}
                    className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded text-sm font-bold transition-colors"
                >
                    {action.label}
                </button>
            )}
            <button
                onClick={onClose}
                className="text-white/70 hover:text-white"
            >
                ✕
            </button>
        </div>
    );
};
